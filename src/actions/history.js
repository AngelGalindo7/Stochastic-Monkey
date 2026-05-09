export async function runBack({ page }) {
  const start = Date.now();
  try {
    const res = await page.raw.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 });
    if (!res) {
      return { success: false, error: 'no history to go back', latencyMs: Date.now() - start };
    }
    return { success: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}

export async function runForward({ page }) {
  const start = Date.now();
  try {
    const res = await page.raw.goForward({ waitUntil: 'domcontentloaded', timeout: 8000 });
    if (!res) {
      return { success: false, error: 'no forward history', latencyMs: Date.now() - start };
    }
    return { success: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}

export async function runRefresh({ page }) {
  const start = Date.now();
  try {
    await page.raw.reload({ waitUntil: 'domcontentloaded', timeout: 8000 });
    return { success: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}
