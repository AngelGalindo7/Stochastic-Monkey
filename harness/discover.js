#!/usr/bin/env node
// Stages 1-2 — discover candidate hosts under vibe-coding platform apexes via
// Certificate Transparency (crt.sh). Passive. Output feeds classify.js.
//
//   node harness/discover.js [--apex lovable.app ...] [--out runs/candidates.txt] [--timeout MS]
//
// With no --apex, uses a default platform set. Writes one host per line
// (deduped, scoped to each apex). Pipe the result into:
//   node harness/classify.js runs/candidates.txt
//
// Note: crt.sh only sees hosts that obtained a logged certificate. For broader
// coverage, augment with external passive tools (subfinder/amass) and append
// their output to the candidates file — the rest of the pipeline is agnostic.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCrtSh, crtShUrl } from './lib/discover.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_APEXES = ['lovable.app', 'base44.app', 'base44.com'];

function parseArgs(argv) {
  const o = { apexes: [], out: 'runs/candidates.txt', timeout: 30000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apex') o.apexes.push(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
  }
  if (o.apexes.length === 0) o.apexes = DEFAULT_APEXES;
  return o;
}

async function fetchCrtSh(apex, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(crtShUrl(apex), {
      signal: ctrl.signal,
      headers: { 'user-agent': 'stochastic-monkey-discover/1.0', accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, status: res.status, hosts: [] };
    const json = await res.json();
    return { ok: true, status: res.status, hosts: parseCrtSh(json, apex) };
  } catch (err) {
    return { ok: false, error: err.message, hosts: [] };
  } finally {
    clearTimeout(timer);
  }
}

const args = parseArgs(process.argv);
const outPath = path.resolve(PROJECT_ROOT, args.out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const all = new Set();
for (const apex of args.apexes) {
  process.stdout.write(`[discover] crt.sh ${apex} … `);
  const r = await fetchCrtSh(apex, args.timeout);
  if (!r.ok) {
    console.log(`failed (${r.error ?? r.status})`);
    continue;
  }
  for (const h of r.hosts) all.add(h);
  console.log(`${r.hosts.length} hosts`);
}

const hosts = [...all].sort();
fs.writeFileSync(outPath, hosts.join('\n') + (hosts.length ? '\n' : ''));
console.log(`\n[discover] unique hosts=${hosts.length}`);
console.log(`[discover] candidates: ${path.relative(PROJECT_ROOT, outPath)}`);
console.log('[discover] next: node harness/classify.js ' + path.relative(PROJECT_ROOT, outPath));
