// Minimal N-worker async pool. Pulls items off a shared cursor; each worker runs
// `task(item, index)` to completion, then takes the next. Resolves when the queue
// drains. A task that throws is caught and surfaced via onError so one bad target
// never tears down the batch.
export async function runPool(items, task, { concurrency = 4, onError = null } = {}) {
  let cursor = 0;
  const n = items.length;

  async function worker() {
    while (cursor < n) {
      const index = cursor++;
      const item = items[index];
      try {
        await task(item, index);
      } catch (err) {
        if (onError) onError(err, item, index);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, n); i++) workers.push(worker());
  await Promise.all(workers);
}

// Registrable-domain-ish key for politeness grouping. Not a full PSL lookup —
// good enough to avoid hammering one apex (e.g. many *.lovable.app subdomains).
export function hostKey(url) {
  try {
    const host = new URL(url).host.toLowerCase();
    const parts = host.split('.');
    return parts.length <= 2 ? host : parts.slice(-2).join('.');
  } catch {
    return url;
  }
}
