// One-shot security-header probe. Uses Node's built-in fetch (no browser
// cookie jar) because security headers are set at the server/CDN layer and
// are the same whether or not the request carries credentials.
//
// Called once per run from main() — not per-step — because headers don't
// change action by action. See DECISION_LOG 018.

const REQUIRED_HEADERS = [
  { name: 'content-security-policy',    label: 'Content-Security-Policy' },
  { name: 'x-frame-options',            label: 'X-Frame-Options' },
  { name: 'x-content-type-options',     label: 'X-Content-Type-Options' },
  { name: 'strict-transport-security',  label: 'Strict-Transport-Security' },
];

function isLocalhost(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export async function checkSecurityHeaders(targetUrl) {
  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    const local = isLocalhost(targetUrl);
    const missing = REQUIRED_HEADERS
      .filter(({ name }) => {
        // HSTS is meaningless on plain HTTP / localhost — skip to avoid noise.
        if (name === 'strict-transport-security' && local) return false;
        return !res.headers.get(name);
      })
      .map(({ label }) => label);

    if (!missing.length) return { signal: null };
    return {
      signal: 'MISSING_SECURITY_HEADERS',
      detail: `missing: ${missing.join(', ')}`,
    };
  } catch {
    return { signal: null };
  }
}
