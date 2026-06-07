import { launchPuppeteer } from './puppeteer.js';
import { launchPlaywright } from './playwright.js';
import { launchLightpanda, NotImplementedError } from './lightpanda.js';

// Error fingerprints that mean the Lightpanda CDP-shaped page can no longer
// drive the SPA. Conservative on purpose: app-level failures (Element not found,
// 4xx responses) must NOT trigger a fallback or we lose useful signal.
const SPA_CRASH_PATTERNS = [
  /Target.*closed/i,
  /Session closed/i,
  /Execution context.*destroyed/i,
  /Cannot find context/i,
  /Protocol error/i,
  /WebSocket.*(closed|error)/i,
  /CDP.*(disconnect|timeout)/i,
  /goto timeout/i,
  /Navigation failed/i,
  /evaluate error/i,
];

export function isSpaCrash(err) {
  if (!err) return false;
  const msg = String(err.message ?? err);
  return SPA_CRASH_PATTERNS.some((re) => re.test(msg));
}

async function tryLaunchLightpanda(opts) {
  if (process.platform === 'win32' && !process.env.LIGHTPANDA_CDP_URL) return null;
  try {
    return await launchLightpanda(opts);
  } catch (err) {
    if (err instanceof NotImplementedError) {
      console.warn(
        `[browser] lightpanda_unavailable (decision=${err.decision}): ${err.message}`,
      );
    } else {
      console.warn(`[browser] lightpanda launch failed: ${err.message}`);
    }
    return null;
  }
}

// Make the puppeteer page's events array also push into the array the
// consumer already holds. The closures inside puppeteer.js capture `events` by
// reference, so we shadow that array's `push` to fan out into the original
// backing array — without this, post-fallback events would silently land in a
// dead array and the surprise pipeline would miss real signal.
// @internal — exported for unit tests only. Must not be called twice on the
// same srcArr: each call wraps push again, causing each item to be forwarded
// N times after N calls.
export function forwardEventsTo(srcArr, dstArr) {
  const origPush = srcArr.push.bind(srcArr);
  srcArr.push = function (...items) {
    for (const it of items) dstArr.push(it);
    return origPush(...items);
  };
}

export async function createBrowser({ engine = 'playwright', preferLightpanda = true, headful = false, userDataDir, storageState } = {}) {
  if (engine === 'playwright') {
    return launchPlaywright({ headful, userDataDir, storageState });
  }

  const launchOpts = { headful, ...(userDataDir ? { userDataDir } : {}) };
  let active = preferLightpanda ? await tryLaunchLightpanda(launchOpts) : null;
  if (!active) active = await launchPuppeteer(launchOpts);

  if (active.kind === 'puppeteer') return active;

  let fellBack = false;

  async function fallbackToPuppeteer(reason, pageRef, eventsBacking, capturesBacking) {
    if (fellBack) return false;
    fellBack = true;
    console.warn(`[browser] lightpanda SPA fallback -> puppeteer (reason=${reason})`);
    const prev = active;
    active = await launchPuppeteer(launchOpts);
    const fresh = await active.newPage();
    pageRef.current = fresh.raw;
    forwardEventsTo(fresh.events, eventsBacking);
    forwardEventsTo(fresh.captures, capturesBacking);
    if (pageRef.lastUrl && pageRef.lastUrl !== 'about:blank') {
      await fresh.raw
        .goto(pageRef.lastUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
        .catch(() => {});
    }
    prev.close().catch(() => {});
    return true;
  }

  return {
    kind: 'lightpanda+fallback',
    raw: active.raw,
    async newPage() {
      const p = await active.newPage();
      const pageRef = { current: p.raw, lastUrl: '' };
      const eventsBacking = p.events;
      const capturesBacking = p.captures ?? [];

      const rawProxy = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') return undefined;
            const probe = pageRef.current[prop];
            if (typeof probe !== 'function') return probe;

            return function (...args) {
              const cur = pageRef.current;
              const fn = cur[prop];
              if (typeof fn !== 'function') {
                throw new TypeError(
                  `page.${String(prop)} not callable after engine swap`,
                );
              }
              if (prop === 'goto' && typeof args[0] === 'string') {
                pageRef.lastUrl = args[0];
              }
              let result;
              try {
                result = fn.apply(cur, args);
              } catch (err) {
                if (!isSpaCrash(err)) throw err;
                return (async () => {
                  if (
                    !(await fallbackToPuppeteer(
                      `${String(prop)}:${err.message}`,
                      pageRef,
                      eventsBacking,
                      capturesBacking,
                    ))
                  )
                    throw err;
                  return pageRef.current[prop].apply(pageRef.current, args);
                })();
              }
              if (result && typeof result.then === 'function') {
                return result.then(
                  (v) => {
                    if (prop === 'url' && typeof v === 'string') pageRef.lastUrl = v;
                    return v;
                  },
                  async (err) => {
                    if (!isSpaCrash(err)) throw err;
                    if (
                      !(await fallbackToPuppeteer(
                        `${String(prop)}:${err.message}`,
                        pageRef,
                        eventsBacking,
                        capturesBacking,
                      ))
                    )
                      throw err;
                    return pageRef.current[prop].apply(pageRef.current, args);
                  },
                );
              }
              if (prop === 'url' && typeof result === 'string') pageRef.lastUrl = result;
              return result;
            };
          },
        },
      );

      return { raw: rawProxy, events: eventsBacking, captures: capturesBacking };
    },
    async close() {
      await active.close();
    },
  };
}
