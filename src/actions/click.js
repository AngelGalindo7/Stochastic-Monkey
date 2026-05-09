export async function runClick({ page, target }) {
  const start = Date.now();
  if (!target?.name) {
    return { success: false, error: 'no target name', latencyMs: 0 };
  }
  const xpath = buildXpathByName(target.role, target.name);
  try {
    const handles = await page.raw.$$(xpath);
    if (!handles.length) {
      return { success: false, error: 'no matching element', latencyMs: Date.now() - start };
    }
    await handles[0].click({ delay: 30 });
    return { success: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}

function buildXpathByName(role, name) {
  const escaped = name.replace(/'/g, '"');
  if (role === 'link') return `xpath/.//a[normalize-space(.)='${escaped}']`;
  if (role === 'button') return `xpath/.//button[normalize-space(.)='${escaped}']`;
  return `xpath/.//*[@role='${role}' and normalize-space(.)='${escaped}']`;
}
