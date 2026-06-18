import { spawn } from 'node:child_process';
import fs from 'node:fs';

// Spawn one Stochastic Monkey run as an isolated subprocess.
//
// The harness talks to the monkey through exactly two channels: the --config
// file going in, and the BUG/ folder coming out. Seed is passed via env
// (HEURISTIC_SEED) which the loader maps to run.seed.
//
// A hard timeout SIGKILLs a hung run so one unresponsive SPA can't stall the
// batch. Resolves (never rejects) with the outcome so the caller can keep going.
export function runMonkey({
  projectRoot,
  cfgPath,
  seed,
  timeoutMs = 150000,
  logPath = null,
}) {
  return new Promise((resolve) => {
    const child = spawn('node', ['src/index.js', '--config', cfgPath], {
      cwd: projectRoot,
      env: { ...process.env, HEURISTIC_SEED: String(seed) },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (logPath) {
        fs.writeFileSync(logPath, `${stdout}\n--- stderr ---\n${stderr}`);
      }
      // The monkey prints "BUG: <folder>" when it surfaced something.
      const bugLine = stdout.split('\n').find((l) => l.startsWith('BUG:'));
      resolve({
        code,
        timedOut,
        sawBugLine: Boolean(bugLine),
        bugFolderRel: bugLine ? bugLine.replace('BUG:', '').trim() : null,
        stdout,
        stderr,
      });
    });
  });
}
