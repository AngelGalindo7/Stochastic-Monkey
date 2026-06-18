#!/usr/bin/env node
// Build a self-contained HTML dashboard from a batch run — visualize + record.
//
//   node harness/dashboard.js [--out DIR] [--open]
//
// Reads <DIR>/results.jsonl + <DIR>/manifest.jsonl, resolves each finding's
// screenshot + evidence folder to a relative path, and writes <DIR>/dashboard.html
// (open it from inside <DIR> so the screenshots and evidence links resolve).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { loadManifest } from './lib/manifest.js';
import { summarize, renderDashboardHtml } from './lib/aggregate.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let outDir = 'runs';
let doOpen = false;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--out') outDir = process.argv[++i];
  else if (process.argv[i] === '--open') doOpen = true;
}
const outRoot = path.resolve(PROJECT_ROOT, outDir);
const resultsPath = path.join(outRoot, 'results.jsonl');
const manifestPath = path.join(outRoot, 'manifest.jsonl');

if (!fs.existsSync(resultsPath) && !fs.existsSync(manifestPath)) {
  console.error(`[dashboard] nothing at ${path.relative(PROJECT_ROOT, outRoot)} — run a batch first.`);
  process.exit(1);
}

// results.jsonl only exists once there's ≥1 finding; a clean run still has a
// manifest. Render the dashboard either way (0 findings is a valid result).
const findings = fs.existsSync(resultsPath)
  ? fs
      .readFileSync(resultsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
  : [];

// Resolve screenshot + evidence to paths relative to the dashboard (outRoot).
for (const f of findings) {
  if (f.folder) {
    f.folderRel = path.relative(outRoot, f.folder);
    const shot = path.join(f.folder, 'screenshot.png');
    if (fs.existsSync(shot)) f.screenshotRel = path.relative(outRoot, shot);
  }
}

const manifest = loadManifest(manifestPath);
const summary = summarize(findings, manifest);
const html = renderDashboardHtml(summary, findings, { generatedAt: new Date().toISOString() });

const htmlPath = path.join(outRoot, 'dashboard.html');
fs.writeFileSync(htmlPath, html);

console.log(`[dashboard] targets=${summary.totals.manifestTargets} findings=${summary.totals.findings} critical=${summary.bySeverity.critical ?? 0}`);
console.log(`[dashboard] wrote ${path.relative(PROJECT_ROOT, htmlPath)}`);

if (doOpen) {
  try {
    execSync(`open "${htmlPath}"`);
  } catch {
    console.log(`[dashboard] open it manually: ${htmlPath}`);
  }
}
