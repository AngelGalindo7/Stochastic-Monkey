// Distributed work queue — pure state machine. The coordinator wraps this with
// HTTP + disk persistence; keeping the logic pure (now passed in) makes the
// atomic-claim and lease-expiry behavior unit-testable.
//
// Each item: { target, status, lease, findings, attempts }
//   status ∈ pending | leased | done | failed | skipped
//   lease  = { workerId, until } when leased
//
// Crash recovery: a leased item whose lease expires is returned to pending
// (the worker that held it is presumed dead), up to maxAttempts.

export function createQueue(targets, { leaseMs = 180000, maxAttempts = 2 } = {}) {
  const items = new Map();
  for (const t of targets) {
    if (!t.slug || items.has(t.slug)) continue;
    items.set(t.slug, { target: t, status: 'pending', lease: null, findings: 0, attempts: 0 });
  }
  return { items, leaseMs, maxAttempts };
}

// Return expired leases to pending (or fail them past maxAttempts). Returns count reaped.
export function reap(q, now) {
  let n = 0;
  for (const it of q.items.values()) {
    if (it.status === 'leased' && it.lease && it.lease.until <= now) {
      it.lease = null;
      if (it.attempts >= q.maxAttempts) it.status = 'failed';
      else it.status = 'pending';
      n++;
    }
  }
  return n;
}

// Atomically hand the next pending item to a worker. Reaps first so crashed
// leases are reclaimed. Returns the target object, or null if nothing pending.
export function claim(q, workerId, now) {
  reap(q, now);
  for (const it of q.items.values()) {
    if (it.status === 'pending') {
      it.status = 'leased';
      it.attempts += 1;
      it.lease = { workerId, until: now + q.leaseMs };
      return it.target;
    }
  }
  return null;
}

// Mark a claimed item finished. status: 'done' (incl. clean/timeout) or 'failed'.
export function complete(q, slug, { status = 'done', findings = 0 } = {}) {
  const it = q.items.get(slug);
  if (!it) return false;
  it.status = status === 'failed' ? 'failed' : status === 'skipped' ? 'skipped' : 'done';
  it.findings = findings;
  it.lease = null;
  return true;
}

// Pre-mark a slug settled (e.g. denylisted, or resumed-from-manifest).
export function preset(q, slug, status) {
  const it = q.items.get(slug);
  if (it) { it.status = status; it.lease = null; }
}

export function stats(q) {
  const s = { total: q.items.size, pending: 0, leased: 0, done: 0, failed: 0, skipped: 0, findings: 0 };
  for (const it of q.items.values()) {
    s[it.status] = (s[it.status] ?? 0) + 1;
    s.findings += it.findings || 0;
  }
  s.remaining = s.pending + s.leased;
  return s;
}
