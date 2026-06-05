import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { loadConfig } from '../src/config/loader.js';

// One-time interactive login capture.
//
//   node scripts/save-auth.mjs            # uses target.url from config.yaml
//   node scripts/save-auth.mjs <url>      # overrides the URL
//
// Opens a real (headed) Chromium, waits for you to log in by hand, then dumps
// the full session — cookies, localStorage, and per-origin state — to
// auth-state.json. launchPlaywright({ storageState: 'auth-state.json' }) replays
// it, so subsequent monkey runs start already authenticated with no manual step.
// Re-run this only when the saved session expires (e.g. refresh-token TTL).
//
// auth-state.json holds live credentials — keep it gitignored, never commit it.

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'auth-state.json');

async function main() {
  const config = loadConfig({ configPath: path.join(PROJECT_ROOT, 'config.yaml') });
  const targetUrl = process.argv[2] ?? config.target.url;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log(
      `\n[save-auth] Opened ${targetUrl} in a real browser.\n` +
        `[save-auth] Log in manually, get the app to its authenticated state,\n` +
        `[save-auth] then come back here and press Enter to capture the session…\n`,
    );

    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', resolve);
    });

    await context.storageState({ path: OUTPUT_PATH });
    console.log(`\n[save-auth] Saved session -> ${path.relative(PROJECT_ROOT, OUTPUT_PATH)}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[save-auth] failed: ${err.message}`);
  process.exitCode = 1;
});
