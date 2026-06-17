#!/usr/bin/env node
// Stages 3+4+5 — liveness filter, vibe-code fingerprint, enrichment.
//
//   node harness/classify.js <candidates-file> [options]
//
// candidates-file: .txt (one url/host per line) or .jsonl ({"url":...}).
// Probes each URL: drops dead ones (non 2xx/3xx), fingerprints the rest, and
// writes the vibe-coded ones (confidence >= --min-confidence) to a targets.jsonl
// the batch runner can consume — carrying platform + Supabase enrichment through.
//
// options:
//   --out PATH          output targets.jsonl     (default runs/targets.jsonl)
//   --min-confidence N  keep threshold           (default 0.3)
//   --concurrency N     parallel probes          (default 6)
//   --rate-ms MS        per-host spacing         (default 500)
//   --timeout MS        per-fetch timeout        (default 12000)
//   --max-scripts N     JS bundles fetched/app   (default 4)
//   --deny-file PATH    extra hosts to skip

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, extractScriptSrcs } from './lib/fingerprint.js';
import { makeDenylist } from './lib/denylist.js';
import { runPool } from './lib/pool.js';
import { makeRateLimiter, hostOf } from './lib/rateLimiter.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (compatible; stochastic-monkey-classifier/1.0)';

function parseArgs(argv) {
  const o = {
    candidates: argv[2],
    out: 'runs/targets.jsonl',
    minConfidence: 0.3,
    concurrency: 6,
    rateMs: 500,
    timeout: 12000,
    maxScripts: 4,
    denyFile: null,
  };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--min-confidence') o.minConfidence = Number(argv[++i]);
    else if (a === '--concurrency') o.concurrency = Number(argv[++i]);
    else if (a === '--rate-ms') o.rateMs = Number(argv[++i]);
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else if (a === '--max-scripts') o.maxScripts = Number(argv[++i]);
    else if (a === '--deny-file') o.denyFile = argv[++i];
  }
  return o;
}

function normalizeUrl(line) {
  const s = line.trim();
  if (s.startsWith('{')) {
    try {
      return JSON.parse(s).url ?? null;
    } catch {
      return null;
    }
  }
  if (!s || s.startsWith('#')) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

async function fetchText(url, { timeoutMs, maxBytes = 700000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': UA } });
    const body = (await res.text().catch(() => '')).slice(0, maxBytes);
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      finalUrl: res.url || url,
      headers: Object.fromEntries(res.headers),
      body,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, finalUrl: url, headers: {}, body: '' };
  } finally {
    clearTimeout(timer);
  }
}

const args = parseArgs(process.argv);
if (!args.candidates) {
  console.error('usage: node harness/classify.js <candidates-file> [--out PATH] [--min-confidence N] [--concurrency N] [--rate-ms MS] [--timeout MS] [--max-scripts N] [--deny-file PATH]');
  process.exit(1);
}

const extraDeny = args.denyFile && fs.existsSync(args.denyFile)
  ? fs.readFileSync(args.denyFile, 'utf8').split('\n')
  : [];
const isDenied = makeDenylist(extraDeny);
const rateLimit = makeRateLimiter(args.rateMs);

const candidates = fs
  .readFileSync(args.candidates, 'utf8')
  .split('\n')
  .map(normalizeUrl)
  .filter(Boolean);

const outPath = path.resolve(PROJECT_ROOT, args.out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
// Per-task watchdog. fetchText already aborts on its own timeout, but in rare
// cases a stalled body read isn't interrupted and a single host would hang its
// pool worker forever — leaving runPool's await unsettled (the "unsettled
// top-level await" warning). This caps the whole per-host task so the pool
// always drains.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`task watchdog: ${label} exceeded ${ms}ms`);
      err.__watchdog = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const outStream = fs.createWriteStream(outPath, { flags: 'w' });

const stats = { candidates: candidates.length, dead: 0, denied: 0, lowConfidence: 0, kept: 0, processed: 0 };
const byPlatform = {};
const PROGRESS_EVERY = 25;
// Backstop budget for one host: liveness + JS-bundle fetches + rate wait.
const TASK_BUDGET = args.timeout * (args.maxScripts + 1) + args.rateMs + 5000;

console.log(`[classify] classifying ${candidates.length} candidates (concurrency=${args.concurrency}, timeout=${args.timeout}ms)…`);

async function classifyOne(url) {
  if (isDenied(url).denied) {
    stats.denied++;
    return;
  }
  await rateLimit(hostOf(url));

  const live = await fetchText(url, { timeoutMs: args.timeout });
  if (!live.ok) {
    stats.dead++;
    return;
  }

  const scripts = extractScriptSrcs(live.body, live.finalUrl).slice(0, args.maxScripts);
  const jsBodies = [];
  for (const s of scripts) {
    const r = await fetchText(s, { timeoutMs: args.timeout, maxBytes: 900000 });
    if (r.body) jsBodies.push(r.body);
  }

  const fp = fingerprint({ url, html: live.body, scripts: jsBodies, headers: live.headers });
  if (fp.confidence < args.minConfidence) {
    stats.lowConfidence++;
    return;
  }

  outStream.write(`${JSON.stringify({
    url,
    platform: fp.platform,
    confidence: fp.confidence,
    supabaseUrl: fp.supabaseUrl,
    anonKey: fp.anonKey,
    signals: fp.signals,
    disclosure_channel: 'none',
  })}\n`);
  stats.kept++;
  byPlatform[fp.platform] = (byPlatform[fp.platform] ?? 0) + 1;
  console.log(`[classify] keep ${fp.platform} (${fp.confidence}) ${url}`);
}

await runPool(
  candidates,
  async (url) => {
    try {
      await withTimeout(classifyOne(url), TASK_BUDGET, url);
    } catch (err) {
      if (err && err.__watchdog) stats.dead++; // hung host → count as dead, move on
      else stats.dead++;
    } finally {
      // Progress heartbeat so long runs over thousands of hosts don't look
      // frozen during stretches of dead / low-confidence targets.
      stats.processed++;
      if (stats.processed % PROGRESS_EVERY === 0 || stats.processed === candidates.length) {
        console.log(`[classify] …${stats.processed}/${candidates.length} (kept=${stats.kept} dead=${stats.dead} low=${stats.lowConfidence} denied=${stats.denied})`);
      }
    }
  },
  { concurrency: args.concurrency },
);

await new Promise((resolve) => outStream.end(resolve));
console.log(`\n[classify] candidates=${stats.candidates} kept=${stats.kept} dead=${stats.dead} denied=${stats.denied} low-confidence=${stats.lowConfidence}`);
console.log(`[classify] by platform: ${JSON.stringify(byPlatform)}`);
console.log(`[classify] targets: ${path.relative(PROJECT_ROOT, outPath)}`);

// Results are written and flushed above. Exit cleanly so any socket left open
// by an aborted fetch can't keep the process hanging after the work is done.
process.exit(0);
