import { queryByXPath } from './locate.js';

export async function runInput({ page, target, dataPool, rng }) {
  const start = Date.now();
  if (!target?.name) return { success: false, error: 'no target', latencyMs: 0 };
  const value = dataPool[Math.floor(rng() * dataPool.length)];
  const escaped = target.name.replace(/'/g, '"');
  const xpath = `//input[@aria-label='${escaped}' or @placeholder='${escaped}' or @name='${escaped}']`;
  try {
    const handles = await queryByXPath(page, xpath);
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
