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
