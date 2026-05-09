export async function runInput({ page, target, dataPool, rng }) {
  const start = Date.now();
  if (!target?.name) return { success: false, error: 'no target', latencyMs: 0 };
  const value = dataPool[Math.floor(rng() * dataPool.length)];
  const xpath = `xpath/.//input[@aria-label='${target.name}' or @placeholder='${target.name}' or @name='${target.name}']`;
  try {
    const handles = await page.raw.$$(xpath);
    if (!handles.length) {
      return { success: false, error: 'no matching input', latencyMs: Date.now() - start };
    }
    await handles[0].click({ clickCount: 3 });
    await handles[0].type(String(value), { delay: 20 });
    return { success: true, value, latencyMs: Date.now() - start };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}
