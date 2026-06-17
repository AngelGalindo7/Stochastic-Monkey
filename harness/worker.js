#!/usr/bin/env node
// Distributed worker — runs on each machine. Claims a target from the
// coordinator, crawls it with the monkey locally (passive), reports findings
// back. Run as many of these on as many machines as you like.
//
//   node harness/worker.js --coordinator http://HOST:8787 [--concurrency 2] [--timeout 150000]
//
// The crawl itself is identical to run-batch (gen config -> monkey -> harvest);
// only the source of targets and sink of results are the network now.

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { generateConfig } from './lib/genConfig.js';
import { runMonkey } from './lib/runMonkey.js';
import { harvest } from './lib/harvest.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const o = { coordinator: null, concurrency: 2, timeout: 150000, seed: 42, out: 'runs-worker' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--coordinator') o.coordinator = argv[++i];
    else if (argv[i] === '--concurrency') o.concurrency = Number(argv[++i]);
    else if (argv[i] === '--timeout') o.timeout = Number(argv[++i]);
    else if (argv[i] === '--seed') o.seed = Number(argv[++i]);
    else if (argv[i] === '--out') o.out = argv[++i];
  }
  return o;
}

const args = parseArgs(process.argv);
if (!args.coordinator) {
  console.error('usage: node harness/worker.js --coordinator http://HOST:8787 [--concurrency N] [--timeout MS]');
  process.exit(1);
}
const base = args.coordinator.replace(/\/$/, '');
const workerId = `${os.hostname()}#${process.pid}`;
const templatePath = path.join(PROJECT_ROOT, 'harness', 'config.template.yaml');
const outRoot = path.resolve(PROJECT_ROOT, args.out);

async function post(endpoint, body) {
  const res = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${endpoint} -> ${res.status}`);
  return res.json();
}

async function processOne(target) {
  const runDir = path.join(outRoot, target.slug);
  const { cfgPath, bugRoot } = generateConfig({ target, runDir, templatePath, seed: args.seed });
  const res = await runMonkey({
    projectRoot: PROJECT_ROOT,
    cfgPath,
    seed: args.seed,
    timeoutMs: args.timeout,
    logPath: path.join(runDir, 'run.log'),
  });
  const findings = harvest({ bugRoot, slug: target.slug, url: target.url, platform: target.platform ?? null });
  const status = res.timedOut ? 'timeout' : res.code === 0 ? 'done' : 'failed';
  await post('/result', { slug: target.slug, status, findings });
  return { findings: findings.length, status };
}

let active = true;
let processed = 0;
let totalFindings = 0;

async function loop(lane) {
  while (active) {
    let claim;
    try {
      claim = await post('/claim', { workerId });
    } catch (err) {
      console.error(`[worker ${lane}] coordinator unreachable: ${err.message} — retrying in 5s`);
      await sleep(5000);
      continue;
    }
    const target = claim.target;
    if (!target) {
      // Nothing pending right now. Coordinator may still re-queue crashed leases,
      // so poll a few times before giving up.
      await sleep(3000);
      const s = await fetch(`${base}/stats`).then((r) => r.json()).catch(() => null);
      if (s && s.remaining === 0) { active = false; break; }
      continue;
    }
    try {
      const r = await processOne(target);
      processed++;
      totalFindings += r.findings;
      console.log(`[worker ${lane}] ${target.slug} -> ${r.status} findings=${r.findings} (total ${processed} done, ${totalFindings} findings)`);
    } catch (err) {
      console.error(`[worker ${lane}] ${target.slug} error: ${err.message}`);
      await post('/result', { slug: target.slug, status: 'failed', findings: [] }).catch(() => {});
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

console.log(`[worker] ${workerId} -> ${base} (concurrency=${args.concurrency})`);
await Promise.all(Array.from({ length: args.concurrency }, (_, i) => loop(i + 1)));
console.log(`[worker] done — processed ${processed} targets, ${totalFindings} findings.`);
process.exit(0);
