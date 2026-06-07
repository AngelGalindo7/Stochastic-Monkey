import path from 'node:path';
import fs from 'node:fs';

export async function runUpload({ page, target, filesPool, rng, projectRoot }) {
  const start = Date.now();
  if (!target?.selector) {
    return { success: false, error: 'no target selector', latencyMs: 0 };
  }
  if (!Array.isArray(filesPool) || filesPool.length === 0) {
    return { success: false, error: 'empty filesPool', latencyMs: 0 };
  }

  const pick = filesPool[Math.floor(rng() * filesPool.length)];
  const filePath = path.isAbsolute(pick.path)
    ? pick.path
    : path.resolve(projectRoot ?? process.cwd(), pick.path);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: `file not found: ${filePath}`, latencyMs: Date.now() - start };
  }

  try {
    const handle = await page.raw.$(target.selector);
    if (!handle) {
      return { success: false, error: `no element for ${target.selector}`, latencyMs: Date.now() - start };
    }
    await handle.uploadFile(filePath);
    return { success: true, value: pick.path, latencyMs: Date.now() - start };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}
