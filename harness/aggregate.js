#!/usr/bin/env node
// Stage 7 CLI — roll up a batch run into a report + disclosure queue.
//
//   node harness/aggregate.js [--out DIR]
//
// Reads <DIR>/results.jsonl + <DIR>/manifest.jsonl, writes <DIR>/report.md and
// <DIR>/disclosure-queue.jsonl, and prints the summary to stdout.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from './lib/manifest.js';
import { summarize, renderReport } from './lib/aggregate.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let outDir = 'runs';
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--out') outDir = process.argv[++i];
}
const outRoot = path.resolve(PROJECT_ROOT, outDir);

const resultsPath = path.join(outRoot, 'results.jsonl');
const manifestPath = path.join(outRoot, 'manifest.jsonl');

if (!fs.existsSync(resultsPath)) {
  console.error(`[aggregate] no results at ${path.relative(PROJECT_ROOT, resultsPath)} — run a batch first.`);
  process.exit(1);
}

const findings = fs
  .readFileSync(resultsPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const manifest = loadManifest(manifestPath);
const summary = summarize(findings, manifest);

const report = renderReport(summary, { generatedAt: new Date().toISOString() });
const reportPath = path.join(outRoot, 'report.md');
fs.writeFileSync(reportPath, report);

const disclosurePath = path.join(outRoot, 'disclosure-queue.jsonl');
fs.writeFileSync(disclosurePath, summary.disclosure.map((f) => JSON.stringify(f)).join('\n'));

console.log(`[aggregate] targets=${summary.totals.manifestTargets} findings=${summary.totals.findings} affected=${summary.totals.targetsWithFindings}`);
console.log(`[aggregate] severity=${JSON.stringify(summary.bySeverity)}`);
console.log(`[aggregate] disclosure (critical+high)=${summary.disclosure.length}`);
console.log(`[aggregate] report:    ${path.relative(PROJECT_ROOT, reportPath)}`);
console.log(`[aggregate] disclosure:${path.relative(PROJECT_ROOT, disclosurePath)}`);
