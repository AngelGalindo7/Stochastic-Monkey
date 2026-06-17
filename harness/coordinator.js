#!/usr/bin/env node
// Distributed coordinator — owns the target queue; workers claim + report.
//
//   node harness/coordinator.js <targets.jsonl> [--port 8787] [--out runs-dist] [--lease-ms 180000]
//
// Endpoints (JSON):
//   POST /claim   {workerId}                    -> {target} | {target:null}
//   POST /result  {slug,status,findings:[...]}  -> {ok:true}
//   GET  /stats                                 -> queue stats
//   GET  /                                      -> human status line
//
// Persists to <out>/manifest.jsonl + <out>/results.jsonl so a restart resumes
// (settled slugs are pre-marked) and aggregate.js/dashboard.js work unchanged.
// No external deps — built on node:http.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './lib/slug.js';
import { makeDenylist } from './lib/denylist.js';
import { loadManifest, isSettled } from './lib/manifest.js';
import { createQueue, claim, complete, preset, stats } from './lib/queue.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const o = { targets: argv[2], port: 8787, out: 'runs-dist', leaseMs: 180000 };
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--port') o.port = Number(argv[++i]);
    else if (argv[i] === '--out') o.out = argv[++i];
    else if (argv[i] === '--lease-ms') o.leaseMs = Number(argv[++i]);
  }
  return o;
}

const args = parseArgs(process.argv);
if (!args.targets) {
  console.error('usage: node harness/coordinator.js <targets.jsonl> [--port N] [--out DIR] [--lease-ms MS]');
  process.exit(1);
}

const outRoot = path.resolve(PROJECT_ROOT, args.out);
fs.mkdirSync(outRoot, { recursive: true });
const manifestPath = path.join(outRoot, 'manifest.jsonl');
const resultsPath = path.join(outRoot, 'results.jsonl');

// Load + normalize targets (each gets a slug).
const targets = fs
  .readFileSync(path.resolve(PROJECT_ROOT, args.targets), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => (l.startsWith('{') ? safeJson(l) : { url: l }))
  .filter((t) => t && t.url)
  .map((t) => ({ ...t, slug: slugify(t.url) }));

function safeJson(l) { try { return JSON.parse(l); } catch { return null; } }

const q = createQueue(targets, { leaseMs: args.leaseMs });

// Resume: pre-mark slugs already settled in a prior manifest.
const prior = loadManifest(manifestPath);
let resumed = 0;
for (const [slug, row] of prior) {
  if (isSettled(row)) { preset(q, slug, row.status === 'skipped' ? 'skipped' : 'done'); resumed++; }
}

// Denylist gate up front.
const isDenied = makeDenylist([]);
let denied = 0;
for (const it of q.items.values()) {
  if (it.status === 'pending' && isDenied(it.target.url).denied) {
    preset(q, it.target.slug, 'skipped');
    appendLine(manifestPath, { slug: it.target.slug, url: it.target.url, status: 'skipped', reason: 'denylist', ts: nowIso() });
    denied++;
  }
}

function nowIso() { return new Date().toISOString(); }
function appendLine(p, obj) { fs.appendFileSync(p, `${JSON.stringify(obj)}\n`); }
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (req.method === 'POST' && req.url === '/claim') {
    const { workerId = 'anon' } = await readBody(req);
    const target = claim(q, workerId, Date.now());
    if (target) appendLine(manifestPath, { slug: target.slug, url: target.url, status: 'running', worker: workerId, ts: nowIso() });
    return send(200, { target });
  }

  if (req.method === 'POST' && req.url === '/result') {
    const { slug, status = 'done', findings = [] } = await readBody(req);
    for (const f of findings) appendLine(resultsPath, f);
    complete(q, slug, { status, findings: findings.length });
    appendLine(manifestPath, { slug, status, findings: findings.length, ts: nowIso() });
    return send(200, { ok: true });
  }

  if (req.method === 'GET' && req.url === '/stats') return send(200, stats(q));

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    const s = stats(q);
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(`stochastic-monkey coordinator\n${JSON.stringify(s, null, 2)}\n`);
  }

  send(404, { error: 'not found' });
});

server.listen(args.port, () => {
  const s = stats(q);
  console.log(`[coordinator] listening on http://0.0.0.0:${args.port}`);
  console.log(`[coordinator] targets=${s.total} pending=${s.pending} resumed-done=${resumed} denied=${denied}`);
  console.log(`[coordinator] out=${path.relative(PROJECT_ROOT, outRoot)}  (aggregate/dashboard with --out ${args.out})`);
  console.log('[coordinator] workers: node harness/worker.js --coordinator http://<this-host>:' + args.port);
});

// Periodic progress + auto-stop when the queue drains.
const ticker = setInterval(() => {
  const s = stats(q);
  console.log(`[coordinator] pending=${s.pending} leased=${s.leased} done=${s.done} failed=${s.failed} findings=${s.findings}`);
  if (s.remaining === 0 && s.total > 0) {
    console.log('[coordinator] all targets settled — shutting down.');
    clearInterval(ticker);
    server.close(() => process.exit(0));
  }
}, 5000);
