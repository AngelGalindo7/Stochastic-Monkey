// One-shot cookie-flag probe. Reads the browser's post-auth cookie jar and
// flags any cookie missing HttpOnly, Secure, or SameSite protections.
//
// Only called for authenticated roles (role !== 'anon'). See DECISION_LOG 018.
//
// Playwright: page.context().cookies()  →  { httpOnly, secure, sameSite }
// Puppeteer:  page.cookies()            →  { httpOnly, secure, sameSite }
// Both APIs return the same field names; we try Playwright first and fall back.

// Names that strongly suggest a cookie carries session credentials.
const SESSION_RE = /token|session|auth|jwt|sb-|supabase|access|refresh|credential/i;

function isLocalhost(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export async function checkCookieSecurity(page, targetUrl) {
  try {
    let cookies;
    try {
      cookies = await page.context().cookies();
    } catch {
      cookies = await page.cookies();
    }
    if (!cookies?.length) return { signal: null };

    const local = isLocalhost(targetUrl);
    const issues = [];

    for (const c of cookies) {
      const flags = [];
      if (!c.httpOnly) flags.push('missing HttpOnly');
      // Secure flag is only meaningful on HTTPS; skip on localhost dev servers.
      if (!local && !c.secure) flags.push('missing Secure');
      if (!c.sameSite || c.sameSite === 'None') flags.push('SameSite=None or unset');
      if (!flags.length) continue;
      const priority = SESSION_RE.test(c.name) ? 'HIGH' : 'LOW';
      issues.push(`${c.name} [${priority}]: ${flags.join(', ')}`);
    }

    if (!issues.length) return { signal: null };
    return {
      signal: 'INSECURE_COOKIES',
      detail: issues.join(' | '),
    };
  } catch {
    return { signal: null };
  }
}
