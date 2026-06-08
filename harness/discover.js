#!/usr/bin/env node
// Stages 1-2 — discover candidate hosts under vibe-coding platform apexes via
// multiple passive sources (resilient when any one is down). Output feeds
// classify.js.
//
//   node harness/discover.js [--apex lovable.app ...] [--out runs/candidates.txt]
//                            [--ht-key KEY] [--timeout MS]
//
// Sources queried per apex (results unioned + deduped):
//   - HackerTarget hostsearch (passive DNS; ~50/query free, more with --ht-key)
//   - crt.sh Certificate Transparency (often overloaded; best-effort)
//
// With no --apex, uses a default platform set. For broader coverage, append
// subfinder/amass output to the candidates file — the rest of the pipeline is
// agnostic to where the hosts came from.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCrtSh, crtShUrl, parseHackerTarget, hackerTargetUrl } from './lib/discover.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_APEXES = ['lovable.app', 'base44.app', 'bolt.new'];

function parseArgs(argv) {
  const o = { apexes: [], out: 'runs/candidates.txt', timeout: 30000, htKey: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apex') o.apexes.push(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else if (a === '--ht-key') o.htKey = argv[++i];
  }
  if (o.apexes.length === 0) o.apexes = DEFAULT_APEXES;
  return o;
}

async function fetchSource(url, timeoutMs, asJson) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'stochastic-monkey-discover/1.0', accept: asJson ? 'application/json' : 'text/plain' },
    });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const data = asJson ? await res.json() : await res.text();
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, error: err.message, data: null };
  } finally {
    clearTimeout(timer);
  }
}

const args = parseArgs(process.argv);
const outPath = path.resolve(PROJECT_ROOT, args.out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const sources = [
  {
    name: 'hackertarget',
    json: false,
    url: (apex) => hackerTargetUrl(apex, args.htKey),
    parse: parseHackerTarget,
  },
  {
    name: 'crt.sh',
    json: true,
    url: (apex) => crtShUrl(apex),
    parse: parseCrtSh,
  },
];

const all = new Set();
const perSource = {};

for (const apex of args.apexes) {
  for (const src of sources) {
    process.stdout.write(`[discover] ${src.name} ${apex} … `);
    const r = await fetchSource(src.url(apex), args.timeout, src.json);
    if (!r.ok) {
      console.log(`failed (${r.error ?? r.status})`);
      continue;
    }
    let hosts = [];
    try {
      hosts = src.parse(r.data, apex);
    } catch (err) {
      console.log(`parse error (${err.message})`);
      continue;
    }
    for (const h of hosts) all.add(h);
    perSource[src.name] = (perSource[src.name] ?? 0) + hosts.length;
    console.log(`${hosts.length} hosts`);
  }
}

const hosts = [...all].sort();
fs.writeFileSync(outPath, hosts.join('\n') + (hosts.length ? '\n' : ''));

console.log(`\n[discover] per-source (pre-dedup): ${JSON.stringify(perSource)}`);
console.log(`[discover] unique hosts=${hosts.length}`);
console.log(`[discover] candidates: ${path.relative(PROJECT_ROOT, outPath)}`);
if (hosts.length) {
  console.log(`[discover] next: node harness/classify.js ${path.relative(PROJECT_ROOT, outPath)}`);
} else {
  console.log('[discover] no hosts — all sources may be rate-limited/down; retry later or add --ht-key.');
}
