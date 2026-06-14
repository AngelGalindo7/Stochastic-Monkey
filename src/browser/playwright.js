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
//   - roles: map of { roleName: { storageState? } | null }. Each role gets its
//     own isolated BrowserContext (no cookie/localStorage bleed between roles).
//     null value = anon role (no session). storageState (legacy) is normalized
//     to roles internally; callers that already pass storageState need no change.
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
export async function launchPlaywright({ headful = false, userDataDir, storageState, roles } = {}) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox'];
  const viewport = { width: 1280, height: 800 };

  // normalize storageState into roles so contextFor() is the single dispatch path.
  const resolvedRoles = roles ?? (storageState ? { user: { storageState } } : null);

  let browser = null;
  let persistentCtx = null;
  // Secondary browser for null-credential (anon) roles when persistentCtx is
  // active. persistentCtx is a single-context launch — calling browser.newContext
  // is unavailable — so anon gets its own ephemeral browser to guarantee a
  // cookie-free baseline. See DECISION_LOG 011.
  let anonBrowser = null;
  const contexts = new Map();

  if (userDataDir) {
    persistentCtx = await chromium.launchPersistentContext(userDataDir, {
      headless: !headful,
      args,
      viewport,
    });
  } else {
    browser = await chromium.launch({ headless: !headful, args });
  }

  async function contextFor(role) {
    if (contexts.has(role)) return contexts.get(role);

    const roleOpts = resolvedRoles?.[role];
    const isNullRole = roleOpts === null;

    // Persistent context covers all non-null roles; null-credential roles
    // (anon) need their own ephemeral browser so the persistent session
    // cannot bleed in via shared profile state.
    if (persistentCtx && !isNullRole) return persistentCtx;

    let ctx;
    if (isNullRole && persistentCtx) {
      if (!anonBrowser) {
        anonBrowser = await chromium.launch({ headless: !headful, args });
      }
      ctx = await anonBrowser.newContext({ viewport });
    } else {
      ctx = await browser.newContext({
        viewport,
        ...(roleOpts?.storageState ? { storageState: roleOpts.storageState } : {}),
      });
    }

    contexts.set(role, ctx);
    return ctx;
  }

  function attachCookieShim(page, ctx) {
    page.setCookie = (...cookies) => ctx.addCookies(cookies);
    page.cookies = (...urls) => ctx.cookies(urls.length ? urls : undefined);
  }

  // CDP uses the same AX role strings (RootWebArea / heading / link /
  // StaticText / ...) as Puppeteer's accessibility.snapshot() output, so the
  // pruned tree, its hash, and the sampled actions match the Puppeteer path.
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

  async function attachAccessibilityShim(page, ctx) {
    const client = await ctx.newCDPSession(page);
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
    raw: browser ?? persistentCtx,
    async newPage(role = 'user') {
      const ctx = await contextFor(role);
      const page = await ctx.newPage();
      const events = attachNetworkEvents(page);
      const captures = attachPlaywrightCapture(page);
      attachCookieShim(page, ctx);
      await attachAccessibilityShim(page, ctx);
      return { raw: page, events, captures, engine: 'playwright', role };
    },
    async close() {
      if (persistentCtx) await persistentCtx.close().catch(() => {});
      for (const ctx of contexts.values()) await ctx.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      if (anonBrowser) await anonBrowser.close().catch(() => {});
    },
  };
}
