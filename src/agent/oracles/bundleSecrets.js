// One-shot oracle. After the initial page.goto(), collects all first-party
// <script src="..."> URLs and scans each bundle (up to 512 KB) for exposed
// credentials. Runs in both passive and active mode — it is purely read-only.

const SCAN_LIMIT_BYTES = 512 * 1024;

// Ordered by severity (HIGH first) so the first match is the worst finding.
const PATTERNS = [
  {
    re: /sk-[a-zA-Z0-9]{32,}/,
    label: 'OpenAI secret key',
    severity: 'high',
  },
  {
    re: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{10,}\./,
    label: 'Supabase anon JWT',
    severity: 'medium',
  },
  {
    re: /https:\/\/[a-z0-9]+\.supabase\.co/,
    label: 'Supabase project URL',
    severity: 'medium',
  },
  {
    re: /AIza[0-9A-Za-z\-_]{35}/,
    label: 'Google API key',
    severity: 'medium',
  },
];

// Fetches `url` inside the browser context and returns up to SCAN_LIMIT_BYTES.
// Returns null on any error (CORS rejection, network failure, non-200).
async function fetchScriptSource(page, url) {
  return page.evaluate(
    async ([u, limit]) => {
      try {
        const r = await fetch(u, { credentials: 'omit' });
        if (!r.ok) return null;
        const text = await r.text();
        return text.length > limit ? text.slice(0, limit) : text;
      } catch {
        return null;
      }
    },
    [url, SCAN_LIMIT_BYTES],
  ).catch(() => null);
}

export async function checkBundleSecrets(page, targetOrigin) {
  // Collect all <script src="..."> URLs present after load.
  const scriptUrls = await page.evaluate(
    () => Array.from(document.querySelectorAll('script[src]')).map((s) => s.src),
  ).catch(() => []);

  // Restrict to first-party scripts; CDN bundles (React, lodash, etc.) are not
  // in scope — they won't carry the app's own credentials.
  let origin;
  try { origin = new URL(targetOrigin).origin; } catch { origin = targetOrigin; }

  const firstParty = scriptUrls.filter((url) => {
    try { return new URL(url).origin === origin; } catch { return false; }
  });

  for (const url of firstParty) {
    const src = await fetchScriptSource(page, url);
    if (!src) continue;

    for (const { re, label, severity } of PATTERNS) {
      if (re.test(src)) {
        return {
          signal: 'EXPOSED_BUNDLE_SECRET',
          detail: `${label} found in ${url}`,
          severity,
        };
      }
    }
  }

  return { signal: null };
}
