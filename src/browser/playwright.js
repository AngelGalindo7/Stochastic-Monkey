import { chromium } from 'playwright';

// Playwright launcher, shaped to be a drop-in peer of launchPuppeteer:
// it returns the same { kind, raw, newPage, close } contract the
// browserFactory consumes, and each page exposes the same { raw, events }
// pair the engine reads. The event push semantics mirror puppeteer.js exactly
// so the surprise pipeline sees identical hard signals regardless of engine.
//
// Auth modes (pick one):
//   - storageState: path to a JSON dumped by scripts/save-auth.js. Restores
//     cookies + localStorage + origin state from a single manual login. This is
//     the zero-manual-auth path — prefer it over cookie seeding.
//   - userDataDir: a persistent on-disk profile (Playwright's equivalent of
//     puppeteer's userDataDir). When set, storageState is ignored — the profile
//     dir IS the persisted state, and layering storageState on top is undefined.
//
// MIGRATION CAVEATS (these live in callers, NOT here — they must be handled
// when wiring the factory + index.js to this launcher):
//   1. waitUntil: index.js passes 'networkidle2' to page.goto. That value is
//      Puppeteer-only and THROWS in Playwright. Valid Playwright values are
//      'load' | 'domcontentloaded' | 'networkidle' | 'commit'. Map
//      'networkidle2' -> 'networkidle' at the call site.
//   2. Cookie API: index.js calls page.raw.setCookie(...) / page.raw.cookies().
//      Those are Puppeteer Page methods; in Playwright cookies live on the
//      context. The compatibility shim below re-exposes both on the page so the
//      existing auth block in index.js runs unchanged.
export async function launchPlaywright({ headful = false, userDataDir, storageState } = {}) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox'];
  const viewport = { width: 1280, height: 800 };

  // Persistent profile and storageState are mutually exclusive (see header).
  let browser = null;
  let context;
  if (userDataDir) {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: !headful,
      args,
      viewport,
    });
  } else {
    browser = await chromium.launch({ headless: !headful, args });
    context = await browser.newContext({
      viewport,
      ...(storageState ? { storageState } : {}),
    });
  }

  function attachEvents(page) {
    const events = [];
    page.on('pageerror', (err) =>
      events.push({ type: 'PAGEERROR', message: err.message, stack: err.stack }),
    );
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        events.push({ type: 'CONSOLE_ERROR', message: msg.text() });
      }
    });
    page.on('requestfailed', (req) =>
      events.push({
        type: 'REQUEST_FAILED',
        url: req.url(),
        reason: req.failure()?.errorText,
      }),
    );
    page.on('response', (res) => {
      const status = res.status();
      if (status < 400) return;
      const resourceType = res.request()?.resourceType?.() ?? 'other';
      const type = status >= 500 ? 'HTTP_5XX' : 'HTTP_4XX';
      events.push({ type, url: res.url(), status, resourceType });
    });
    return events;
  }

  // Puppeteer-API compatibility shim: cookies are a context-level concept in
  // Playwright, but index.js drives them through page.setCookie / page.cookies.
  // Re-expose both on the page, translating the varargs/array signature
  // difference, so the auth seeding block needs no engine-aware branching.
  function attachCookieShim(page) {
    page.setCookie = (...cookies) => context.addCookies(cookies);
    page.cookies = (...urls) => context.cookies(urls.length ? urls : undefined);
  }

  return {
    kind: 'playwright',
    raw: browser ?? context,
    async newPage() {
      const page = await context.newPage();
      const events = attachEvents(page);
      attachCookieShim(page);
      return { raw: page, events };
    },
    async close() {
      await context.close();
      if (browser) await browser.close();
    },
  };
}
