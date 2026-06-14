// Cross-module signal consistency. Bug pattern: a signal added to HARD_SIGNALS
// with severity X but SIGNAL_SEVERITY with severity Y causes the triage module
// to report different severities depending on which code path reached it.
// (Caught in history: CONSOLE_ERROR was medium in HARD_SIGNALS, low in
// SIGNAL_SEVERITY — fixed in fix(triage severity).)
//
// Two namespaces exist by design:
//   HARD_SIGNALS   — oracle output keys (HTTP_4XX_NAV, DOM_FROZEN, …)
//   SIGNAL_SEVERITY — raw page-event types (HTTP_4XX, REQUEST_FAILED, …)
// The overlap (signals present in both) must agree on severity.
import { describe, it, expect } from 'vitest';
import { HARD_SIGNALS } from '../../src/agent/expectations.js';
import { SIGNAL_SEVERITY } from '../../src/triage/severity.js';

const sharedSignals = Object.keys(HARD_SIGNALS).filter((sig) => sig in SIGNAL_SEVERITY);

describe('signal consistency: shared HARD_SIGNALS ↔ SIGNAL_SEVERITY keys', () => {
  it('at least one signal is shared between the two tables (sanity)', () => {
    expect(sharedSignals.length).toBeGreaterThan(0);
  });

  it('all known high-value signals remain in the shared set', () => {
    const required = ['HTTP_5XX', 'PAGEERROR', 'ASSET_4XX', 'DOM_FROZEN', 'PERF_BREACH'];
    for (const sig of required) {
      expect(sharedSignals, `${sig} was removed from one of the two tables`).toContain(sig);
    }
  });

  it('shared signals have matching severity in both tables', () => {
    for (const sig of sharedSignals) {
      expect(
        SIGNAL_SEVERITY[sig],
        `${sig}: HARD_SIGNALS=${HARD_SIGNALS[sig].severity} but SIGNAL_SEVERITY=${SIGNAL_SEVERITY[sig]}`,
      ).toBe(HARD_SIGNALS[sig].severity);
    }
  });
});

// Anchor tests for the specific signals that have triggered mismatches in the
// past. These are deliberately redundant with the loop above — if someone
// removes a signal from SIGNAL_SEVERITY the loop shrinks silently, but these
// will still catch the regression.
describe('signal consistency: known-anchor pairs', () => {
  it('HTTP_5XX is critical in both modules', () => {
    expect(HARD_SIGNALS.HTTP_5XX.severity).toBe('critical');
    expect(SIGNAL_SEVERITY.HTTP_5XX).toBe('critical');
  });

  it('PAGEERROR is high in both modules', () => {
    expect(HARD_SIGNALS.PAGEERROR.severity).toBe('high');
    expect(SIGNAL_SEVERITY.PAGEERROR).toBe('high');
  });

  it('DOM_FROZEN is medium in both modules', () => {
    expect(HARD_SIGNALS.DOM_FROZEN.severity).toBe('medium');
    expect(SIGNAL_SEVERITY.DOM_FROZEN).toBe('medium');
  });

  it('ASSET_4XX is medium in both modules', () => {
    expect(HARD_SIGNALS.ASSET_4XX.severity).toBe('medium');
    expect(SIGNAL_SEVERITY.ASSET_4XX).toBe('medium');
  });

  it('PERF_BREACH is low in both modules', () => {
    expect(HARD_SIGNALS.PERF_BREACH.severity).toBe('low');
    expect(SIGNAL_SEVERITY.PERF_BREACH).toBe('low');
  });

  it('HTTP_4XX_NAV is medium in HARD_SIGNALS (oracle-only — no SIGNAL_SEVERITY entry by design)', () => {
    expect(HARD_SIGNALS.HTTP_4XX_NAV.severity).toBe('medium');
  });
});

// Guard: when a new signal is added to HARD_SIGNALS, the author must also add
// it to SIGNAL_SEVERITY (or justify the omission). This test will fail if a
// new signal appears in HARD_SIGNALS that has NO entry in SIGNAL_SEVERITY AND
// is not in the intentional-omission list below.
const INTENTIONAL_ORACLE_ONLY = new Set([
  'HTTP_4XX_NAV', // navigational rename of HTTP_4XX — raw events still use HTTP_4XX
  // Authz-replay verdicts are synthesized by the replay oracle, not raw page events,
  // so they have no SIGNAL_SEVERITY counterpart by design. scoreState carries their
  // severity directly (adversarial A1/A3).
  'CROSS_ACCOUNT_LEAK',
  'AUTHZ_UNCERTAIN',
]);

describe('signal consistency: HARD_SIGNALS coverage in SIGNAL_SEVERITY', () => {
  it('every non-oracle-only hard signal has a SIGNAL_SEVERITY entry', () => {
    for (const sig of Object.keys(HARD_SIGNALS)) {
      if (INTENTIONAL_ORACLE_ONLY.has(sig)) continue;
      expect(
        SIGNAL_SEVERITY[sig],
        `${sig} is in HARD_SIGNALS but missing from SIGNAL_SEVERITY (add it or add to INTENTIONAL_ORACLE_ONLY)`,
      ).toBeDefined();
    }
  });
});
