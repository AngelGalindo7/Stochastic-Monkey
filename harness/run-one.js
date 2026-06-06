#!/usr/bin/env node
// Single-target driver — proves the harness contract end to end:
//   generate config  ->  run the monkey  ->  harvest BUG/ output
//
// Usage:  node harness/run-one.js <url> [seed]
// Example: node harness/run-one.js https://example.com 42

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './lib/slug.js';
import { generateConfig } from './lib/genConfig.js';
import { runMonkey } from './lib/runMonkey.js';
import { harvest } from './lib/harvest.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const url = process.argv[2];
if (!url) {
  console.error('usage: node harness/run-one.js <url> [seed]');
  process.exit(1);
}
const seed = Number(process.argv[3] ?? 42);
const slug = slugify(url);
const runDir = path.join(PROJECT_ROOT, 'runs', slug);
const templatePath = path.join(PROJECT_ROOT, 'harness', 'config.template.yaml');

console.log(`[harness] target = ${url}`);
console.log(`[harness] slug   = ${slug}`);

const { cfgPath, bugRoot } = generateConfig({
  target: { url },
  runDir,
  templatePath,
  seed,
});
console.log(`[harness] config = ${path.relative(PROJECT_ROOT, cfgPath)}`);
console.log(`[harness] bugRoot= ${path.relative(PROJECT_ROOT, bugRoot)}`);
console.log('[harness] running monkey (passive)…');

const res = await runMonkey({
  projectRoot: PROJECT_ROOT,
  cfgPath,
  seed,
  timeoutMs: 150000,
  logPath: path.join(runDir, 'run.log'),
});

console.log(
  `[harness] monkey exit=${res.code}${res.timedOut ? ' (TIMEOUT, killed)' : ''}`,
);

const findings = harvest({ bugRoot, slug, url });
console.log(`[harness] findings = ${findings.length}`);
for (const f of findings) {
  console.log(`  - [${f.severity}] ${f.signal}  ${path.relative(PROJECT_ROOT, f.folder)}`);
}
