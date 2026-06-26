// Smoke-test runner for the flag-for-review signals (CONSOLE_ERROR + DOM_FROZEN).
// Usage: node tests/smoke/run.mjs
// Starts a local fixture server, runs the monkey against each fixture, and asserts
// the expected signal appears in severity.json. Both signals are flag-for-review, so
// the smoke configs route flaggedRoot into tests/smoke/BUG where this runner looks.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONKEY_ROOT = path.resolve(__dirname, '../..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const PORT = 3099;
const SMOKE_BUG_ROOT = path.join(MONKEY_ROOT, 'tests', 'smoke', 'BUG');

// ── fixture server ──────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const filePath = path.join(FIXTURES_DIR, req.url.split('?')[0]);
  try {
    const body = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((resolve) => server.listen(PORT, resolve));
console.log(`fixture server → http://localhost:${PORT}\n`);

// ── helpers ─────────────────────────────────────────────────────────────────
function cleanBugDir() {
  if (fs.existsSync(SMOKE_BUG_ROOT)) {
    fs.rmSync(SMOKE_BUG_ROOT, { recursive: true, force: true });
  }
}

function findSeverityJson() {
  if (!fs.existsSync(SMOKE_BUG_ROOT)) return null;
  for (const entry of fs.readdirSync(SMOKE_BUG_ROOT)) {
    const candidate = path.join(SMOKE_BUG_ROOT, entry, 'severity.json');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ── scenarios ────────────────────────────────────────────────────────────────
const SCENARIOS = [
  {
    name: 'CONSOLE_ERROR',
    config: path.join(__dirname, 'config-console-error.yaml'),
    expectedSignal: 'CONSOLE_ERROR',
  },
  {
    name: 'DOM_FROZEN',
    config: path.join(__dirname, 'config-dom-frozen.yaml'),
    expectedSignal: 'DOM_FROZEN',
  },
];

let passed = 0;
let failed = 0;

for (const scenario of SCENARIOS) {
  cleanBugDir();
  process.stdout.write(`[${scenario.name}] running… `);

  const result = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['src/index.js', '--config', scenario.config],
      { cwd: MONKEY_ROOT, encoding: 'utf8' },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => resolve({ error: err, stdout, stderr }));
    child.on('close', () => resolve({ error: null, stdout, stderr }));
    setTimeout(() => { child.kill(); resolve({ error: new Error('timeout'), stdout, stderr }); }, 60_000);
  });

  if (result.error) {
    console.log(`FAIL (spawn: ${result.error.message})`);
    failed++;
    continue;
  }

  const severityPath = findSeverityJson();
  if (!severityPath) {
    console.log('FAIL (no BUG folder)');
    if (result.stderr?.trim()) console.log('  stderr:', result.stderr.trim().slice(0, 500));
    if (result.stdout?.trim()) console.log('  stdout:', result.stdout.trim().slice(0, 500));
    failed++;
    continue;
  }

  const { signal } = JSON.parse(fs.readFileSync(severityPath, 'utf8'));
  if (signal === scenario.expectedSignal) {
    console.log(`PASS  (signal=${signal})`);
    passed++;
  } else {
    console.log(`FAIL  (expected=${scenario.expectedSignal} got=${signal})`);
    failed++;
  }
}

cleanBugDir();
server.close();
console.log(`\n${passed}/${SCENARIOS.length} passed`);
process.exitCode = failed > 0 ? 1 : 0;
