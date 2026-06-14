import { chromium } from 'playwright';
import { attachNetworkEvents, attachPlaywrightCapture } from './network.js';

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
//   3. Accessibility API: Playwright (>=1.55) REMOVED page.accessibility, but
//      a11yTree.js calls page.accessibility.snapshot() every step. The shim
//      below rebuilds an equivalent { role, name, value, children } tree from
//      CDP Accessibility.getFullAXTree — which carries the identical AX role
//      vocabulary Puppeteer's snapshot() is itself built from — so perception,
//      state abstraction, and action sampling run engine-agnostic.
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

  // Puppeteer-API compatibility shim: cookies are a context-level concept in
  // Playwright, but index.js drives them through page.setCookie / page.cookies.
  // Re-expose both on the page, translating the varargs/array signature
  // difference, so the auth seeding block needs no engine-aware branching.
  function attachCookieShim(page) {
    page.setCookie = (...cookies) => context.addCookies(cookies);
    page.cookies = (...urls) => context.cookies(urls.length ? urls : undefined);
  }

  // Rebuild the flat CDP AXNode list into the nested { role, name, value,
  // children } shape Puppeteer's accessibility.snapshot() returns. CDP uses the
  // same AX role strings (RootWebArea / heading / link / StaticText / ...), so
  // the pruned tree, its hash, and the sampled actions match the Puppeteer path.
  function axNodesToTree(nodes) {
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const childIds = new Set();
    for (const n of nodes) for (const id of n.childIds ?? []) childIds.add(id);
    const root = nodes.find((n) => !childIds.has(n.nodeId)) ?? nodes[0];

    function build(n) {
      if (!n) return null;
      const role = n.role?.value ?? 'none';
      const name = n.name?.value ?? '';
      const value = n.value?.value;
      const children = (n.childIds ?? [])
        .map((id) => build(byId.get(id)))
        .filter(Boolean);
      const out = { role };
      if (name) out.name = name;
      if (typeof value === 'string' && value.length) out.value = value;
      if (children.length) out.children = children;
      return out;
    }
    return build(root);
  }

  // Accessibility shim (see caveat 3): one CDP session per page, reused across
  // steps. Re-expose page.accessibility.snapshot() so a11yTree.js is unchanged.
  async function attachAccessibilityShim(page) {
    const client = await context.newCDPSession(page);
    await client.send('Accessibility.enable');
    page.accessibility = {
      snapshot: async () => {
        const { nodes } = await client.send('Accessibility.getFullAXTree');
        return axNodesToTree(nodes);
      },
    };
  }

  return {
    kind: 'playwright',
    raw: browser ?? context,
    async newPage() {
      const page = await context.newPage();
      const events = attachNetworkEvents(page);
      const captures = attachPlaywrightCapture(page);
      attachCookieShim(page);
      await attachAccessibilityShim(page);
      return { raw: page, events, captures, engine: 'playwright' };
    },
    async close() {
      await context.close();
      if (browser) await browser.close();
    },
  };
}
