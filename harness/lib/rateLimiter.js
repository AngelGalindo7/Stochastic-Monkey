// Per-key minimum-interval gate. Spaces calls sharing a key by at least
// minIntervalMs without blocking other keys — politeness so we don't hammer a
// single origin. Keyed on full host by default (each app gets its own budget),
// so distinct subdomains of a shared apex (e.g. *.lovable.app) still run in
// parallel rather than serializing into one global 1/sec queue.
export function makeRateLimiter(minIntervalMs = 0) {
  const nextAllowed = new Map();
  return async function acquire(key) {
    if (!minIntervalMs) return;
    const now = Date.now();
    const prev = nextAllowed.get(key) ?? 0;
    const start = Math.max(now, prev);
    // Reserve this key's next slot before awaiting so concurrent workers that
    // share the key queue in order instead of all reading the same stale value.
    nextAllowed.set(key, start + minIntervalMs);
    const wait = start - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
}

// Full-host key (default rate-limit scope).
export function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
}
