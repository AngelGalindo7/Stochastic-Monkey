#!/usr/bin/env node
// Stage 6b batch runner — passive mass-test over a target list.
//
//   node harness/run-batch.js <targets-file> [options]
//
// targets-file: .jsonl (one {"url":...,...} per line) OR .txt (one url per line)
// options:
//   --concurrency N   parallel workers           (default 4)
//   --seed N          monkey seed                 (default 42)
//   --timeout MS      per-target hard kill        (default 150000)
//   --deny-file PATH  extra hosts/substrings to skip (one per line)
//   --out DIR         output root                 (default runs/)
//
// Resumable: re-running skips targets already done/skipped in the manifest.
// Output: <out>/manifest.jsonl, <out>/results.jsonl, and <out>/<slug>/ per target.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './lib/slug.js';
import { generateConfig } from './lib/genConfig.js';
import { runMonkey } from './lib/runMonkey.js';
import { harvest } from './lib/harvest.js';
import { makeDenylist } from './lib/denylist.js';
import { loadManifest, appendRow, isSettled } from './lib/manifest.js';
import { runPool } from './lib/pool.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { concurrency: 4, seed: 42, timeout: 150000, denyFile: null, outDir: 'runs' };
  out.targetsFile = argv[2];
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--timeout') out.timeout = Number(argv[++i]);
    else if (a === '--deny-file') out.denyFile = argv[++i];
    else if (a === '--out') out.outDir = argv[++i];
  }
  return out;
}

function loadTargets(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const targets = [];
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    if (line.startsWith('{')) {
      try {
        const obj = JSON.parse(line);
        if (obj.url) targets.push(obj);
      } catch {
        /* skip bad jsonl */
      }
    } else {
      targets.push({ url: line }); // plain url line
    }
  }
  return targets;
}

const args = parseArgs(process.argv);
if (!args.targetsFile) {
  console.error('usage: node harness/run-batch.js <targets-file> [--concurrency N] [--seed N] [--timeout MS] [--deny-file PATH] [--out DIR]');
  process.exit(1);
}

const outRoot = path.resolve(PROJECT_ROOT, args.outDir);
fs.mkdirSync(outRoot, { recursive: true });
const manifestPath = path.join(outRoot, 'manifest.jsonl');
const resultsPath = path.join(outRoot, 'results.jsonl');
const templatePath = path.join(PROJECT_ROOT, 'harness', 'config.template.yaml');

const extraDeny = args.denyFile && fs.existsSync(args.denyFile)
  ? fs.readFileSync(args.denyFile, 'utf8').split('\n')
  : [];
const isDenied = makeDenylist(extraDeny);

const targets = loadTargets(args.targetsFile);
const manifest = loadManifest(manifestPath);

// Build the work list: skip settled, mark denied as skipped up front.
const work = [];
let skippedDeny = 0;
let skippedDone = 0;
for (const t of targets) {
  const slug = slugify(t.url);
  if (isSettled(manifest.get(slug))) {
    skippedDone++;
    continue;
  }
  const deny = isDenied(t.url);
  if (deny.denied) {
    appendRow(manifestPath, { slug, url: t.url, status: 'skipped', reason: deny.reason, ts: nowStamp() });
    skippedDeny++;
    continue;
  }
  work.push({ ...t, slug });
}

function nowStamp() {
  // Avoid Date.now()/new Date() determinism caveats elsewhere; here it's fine.
  return new Date().toISOString();
}

console.log(`[batch] targets=${targets.length} queued=${work.length} resumed-skip=${skippedDone} denied=${skippedDeny}`);
console.log(`[batch] concurrency=${args.concurrency} seed=${args.seed} timeout=${args.timeout}ms`);
console.log(`[batch] out=${path.relative(PROJECT_ROOT, outRoot)}`);

let done = 0;
const totalFindings = { count: 0, bySeverity: {} };

await runPool(
  work,
  async (t) => {
    const runDir = path.join(outRoot, t.slug);
    appendRow(manifestPath, { slug: t.slug, url: t.url, status: 'running', ts: nowStamp() });

    const { cfgPath, bugRoot } = generateConfig({ target: t, runDir, templatePath, seed: args.seed });
    const res = await runMonkey({
      projectRoot: PROJECT_ROOT,
      cfgPath,
      seed: args.seed,
      timeoutMs: args.timeout,
      logPath: path.join(runDir, 'run.log'),
    });

    const findings = harvest({ bugRoot, slug: t.slug, url: t.url, platform: t.platform ?? null });
    for (const f of findings) {
      appendRow(resultsPath, f);
      totalFindings.count++;
      totalFindings.bySeverity[f.severity] = (totalFindings.bySeverity[f.severity] ?? 0) + 1;
    }

    // Status: timeout is its own settled state (deterministic under a fixed
    // seed — don't retry). exit 0 = done. Anything else = failed (retryable).
    let status;
    if (res.timedOut) status = 'timeout';
    else if (res.code === 0) status = 'done';
    else status = 'failed';

    appendRow(manifestPath, {
      slug: t.slug,
      url: t.url,
      status,
      exitCode: res.code,
      timedOut: res.timedOut,
      findings: findings.length,
      ts: nowStamp(),
    });

    done++;
    const sevStr = findings.length ? findings.map((f) => f.severity[0].toUpperCase()).join('') : '-';
    console.log(`[batch] (${done}/${work.length}) ${t.slug}  exit=${res.code}${res.timedOut ? '/timeout' : ''}  findings=${findings.length} [${sevStr}]`);
  },
  {
    concurrency: args.concurrency,
    onError: (err, t) => {
      appendRow(manifestPath, { slug: t.slug, url: t.url, status: 'failed', reason: err.message, ts: nowStamp() });
      console.error(`[batch] ERROR ${t.slug}: ${err.message}`);
    },
  },
);

console.log('\n[batch] complete.');
console.log(`[batch] findings total=${totalFindings.count} ${JSON.stringify(totalFindings.bySeverity)}`);
console.log(`[batch] results: ${path.relative(PROJECT_ROOT, resultsPath)}`);
console.log(`[batch] manifest: ${path.relative(PROJECT_ROOT, manifestPath)}`);
