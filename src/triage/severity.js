export const SIGNAL_SEVERITY = {
  PAGEERROR: 'high',
  HTTP_5XX: 'critical',
  HTTP_4XX: 'medium',
  ASSET_4XX: 'medium',
  REQUEST_FAILED: 'medium',
  CONSOLE_ERROR: 'low',
  PERF_BREACH: 'low',
  DOM_FROZEN: 'medium',
};

const RANK = { critical: 4, high: 3, medium: 2, low: 1 };

export function highestSeverity(signals) {
  let best = 'low';
  for (const sig of signals) {
    const sev = SIGNAL_SEVERITY[sig] ?? 'low';
    if (RANK[sev] > RANK[best]) best = sev;
  }
  return best;
}

export function severityFromEvents(events) {
  const types = events.map((e) => e.type);
  return highestSeverity(types);
}

export function severityFromScore(score) {
  if (score >= 0.95) return 'critical';
  if (score >= 0.85) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}
