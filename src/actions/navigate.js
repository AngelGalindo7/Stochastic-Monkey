export async function runNavigate({ page, allowedDomains, currentUrl }) {
  const start = Date.now();
  try {
    const links = await page.raw.$$eval('a[href]', (as) =>
      as.map((a) => a.href).filter(Boolean),
    );
    const internal = links.filter((href) => {
      try {
        const u = new URL(href, currentUrl);
        return allowedDomains.some((d) => u.hostname.endsWith(d));
      } catch {
        return false;
      }
    });
    if (internal.length === 0) {
      return { success: false, error: 'no internal links', latencyMs: Date.now() - start };
    }
    const target = internal[Math.floor(Math.random() * internal.length)];
    await page.raw.goto(target, { waitUntil: 'domcontentloaded', timeout: 8000 });
    return { success: true, navigatedTo: target, latencyMs: Date.now() - start };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}
