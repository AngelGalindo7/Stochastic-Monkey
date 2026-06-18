// Stage 0 scope rail. Drop sensitive targets BEFORE they ever reach the monkey.
// Passive crawling is low-impact, but we still never touch gov/military, health,
// education, or finance domains — matching the escape.tech ethical exclusions.

const BUILTIN_PATTERNS = [
  // Government / military
  /(^|\.)gov(\.[a-z]{2})?$/i,
  /(^|\.)mil(\.[a-z]{2})?$/i,
  /(^|\.)gov\.[a-z]{2}$/i,
  // Education
  /(^|\.)edu(\.[a-z]{2})?$/i,
  /(^|\.)ac\.[a-z]{2}$/i,
  // Health — keyword must occupy its own hostname segment or sub-segment
  // (delimited by ^, ., or -) so compound words like mentalhealth-tracker don't FP.
  /(^|[.-])(health|medical|clinic|hospital|patient|pharma|therap)([.-]|$)/i,
  // Finance
  /(^|[.-])(bank|finance|insur|payment|lending|crypto|wallet|broker)([.-]|$)/i,
];

// Build a matcher. `extraHosts` is an optional list of exact hosts or substrings
// to also deny (e.g. from a user-supplied --deny-file).
export function makeDenylist(extraHosts = []) {
  const extra = extraHosts
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h && !h.startsWith('#'));

  return function isDenied(url) {
    let host;
    try {
      host = new URL(url).host.toLowerCase();
    } catch {
      return { denied: true, reason: 'unparseable url' };
    }
    for (const re of BUILTIN_PATTERNS) {
      if (re.test(host)) return { denied: true, reason: `matched ${re}` };
    }
    for (const h of extra) {
      if (host === h || host.includes(h)) {
        return { denied: true, reason: `deny-file: ${h}` };
      }
    }
    return { denied: false, reason: null };
  };
}
