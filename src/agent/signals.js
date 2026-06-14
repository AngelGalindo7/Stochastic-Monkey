export const DOM_FROZEN_SETTLE_MS = 400;

// Patterns whose presence in a console.error message means the error is
// dev-tooling noise or a known third-party script — not an app crash.
// Covers: HMR/bundler noise, React DevTools notices, React 18 prop/hook
// warnings (Warning: prefix), Vue warn, browser Violations, extension errors,
// and analytics injected inline that can't be filtered by origin alone.
export const CONSOLE_ERROR_DENYLIST = [
  /\[HMR\]/,
  /\[vite\]/i,
  /\[webpack/i,
  /Download the React DevTools/i,
  /React DevTools/i,
  /^\[Vue warn\]/,
  /^Warning:/,
  /ResizeObserver loop/,
  /net::ERR_ABORTED/,
  /chrome-extension:\/\//,
  /moz-extension:\/\//,
  /googletagmanager/i,
  /google-analytics/i,
  /doubleclick/i,
  /\bfbq\s*is not defined\b/,
  /\[Violation\]/,
  /Intervention:/,
];

// Returns false when the console error's source URL is a browser extension or
// a third-party origin. Inline scripts (no url) are treated as first-party
// so inline analytics that slipped past the denylist can still be filtered
// by the extension check above.
export function isFirstPartyConsoleError(event, targetOrigin) {
  const url = event.url ?? '';
  if (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) return false;
  if (url && targetOrigin) {
    try { return new URL(url).origin === targetOrigin; } catch { return false; }
  }
  return true;
}

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
