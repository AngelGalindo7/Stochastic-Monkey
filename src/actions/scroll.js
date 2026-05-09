export async function runScroll({ page, rng }) {
  const start = Date.now();
  const dy = Math.floor((rng() - 0.3) * 1200);
  try {
    await page.raw.evaluate((y) => window.scrollBy(0, y), dy);
    return { success: true, dy, latencyMs: Date.now() - start };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}
