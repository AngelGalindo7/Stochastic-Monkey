const NOISE_PATTERNS = [
  /\/favicon\.ico$/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /doubleclick\.net/i,
  /facebook\.com\/tr/i,
];

// Known-noisy console.error patterns that fire even on healthy pages.
// Covers: browser quirks, extension-injected errors, and inline analytics
// scripts (GTM, ad pixels) that run in the first-party origin but produce
// noise unrelated to the app under test.
export const CONSOLE_ERROR_DENYLIST = [
  /ResizeObserver loop/,
  /net::ERR_ABORTED/,
  // Extension errors surfaced with or without an extension URL
  /chrome-extension:\/\//,
  /moz-extension:\/\//,
  // GTM / analytics / ad-pixel noise injected as inline scripts
  /googletagmanager/i,
  /google-analytics/i,
  /doubleclick/i,
  /\bfbq\s*is not defined\b/,
  // Chrome [Violation] messages (long task, forced style recalc) logged as errors
  /\[Violation\]/,
  /Intervention:/,
];

export function isNoiseUrl(url) {
  if (!url) return false;
  return NOISE_PATTERNS.some((re) => re.test(url));
}

// Returns false for errors whose source URL is a browser extension, to avoid
// treating extension-injected errors as app signal.
export function isFirstPartyConsoleError(event, targetOrigin) {
  const { url } = event;
  if (url) {
    if (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) {
      return false;
    }
    try { return new URL(url).origin === targetOrigin; } catch { return false; }
  }
  // Inline scripts have no URL. Treat as first-party; the denylist filters
  // analytics and extension patterns that don't carry a source URL.
  return true;
}

export function pageEventsToHardSignals(events, targetOrigin) {
  const out = [];
  const evidence = [];
  for (const e of events) {
    if (e.type === 'PAGEERROR') {
      out.push('PAGEERROR');
      evidence.push({ signal: 'PAGEERROR', detail: e.message });
    } else if (e.type === 'HTTP_5XX') {
      out.push('HTTP_5XX');
      evidence.push({ signal: 'HTTP_5XX', detail: `${e.status} ${e.url}` });
    } else if ((e.type === 'HTTP_4XX' || e.type === 'REQUEST_FAILED') && !isNoiseUrl(e.url)) {
      out.push('ASSET_4XX');
      evidence.push({ signal: 'ASSET_4XX', detail: `${e.status ?? 'fail'} ${e.url}` });
    } else if (e.type === 'CONSOLE_ERROR') {
      const noisy = CONSOLE_ERROR_DENYLIST.some((re) => re.test(e.message));
      if (!noisy && isFirstPartyConsoleError(e, targetOrigin)) {
        out.push('CONSOLE_ERROR');
        evidence.push({ signal: 'CONSOLE_ERROR', detail: e.message.slice(0, 200) });
      }
    }
  }
  return { signals: out, evidence };
}

export const DOM_FROZEN_SETTLE_MS = 400;

export async function isDomEmptyNow(page) {
  return page.raw.evaluate(() => {
    const body = document.body;
    if (!body) return true;
    const hasContent = (el) =>
      el.textContent.trim().length > 0 ||
      el.querySelector('img, svg, canvas, video, iframe') !== null;
    if (hasContent(body)) return false;
    const containers = Array.from(body.children);
    if (containers.length === 0) return true;
    return containers.every((el) => el.children.length === 0);
  });
}

// Re-checks after a settle delay so a transient empty DOM mid-SPA-hydration
// is not misreported as frozen.
export async function checkDomFrozen(page, { settleMs = 0 } = {}) {
  try {
    if (!(await isDomEmptyNow(page))) return false;
    if (settleMs > 0) {
      await new Promise((r) => setTimeout(r, settleMs));
      return await isDomEmptyNow(page);
    }
    return true;
  } catch {
    return false;
  }
}
