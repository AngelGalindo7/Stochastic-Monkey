import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/llm/openai.js', () => ({
  complete: vi.fn(),
  llmAvailable: vi.fn(() => true),
}));

vi.mock('../../src/llm/gemini.js', () => ({
  complete: vi.fn(),
  llmAvailable: vi.fn(() => true),
}));

import { complete } from '../../src/llm/openai.js';
import { scoreState, predict, HARD_SIGNALS } from '../../src/agent/expectations.js';

const tree = (children = []) => ({ role: 'main', children });

describe('expectations.scoreState — bug detection (hard signals)', () => {
  beforeEach(() => complete.mockReset());

  it('never calls the LLM', () => {
    scoreState({ observed: tree(), hardSignals: ['HTTP_500'] });
    scoreState({ observed: tree(), hardSignals: [] });
    expect(complete).not.toHaveBeenCalled();
  });

  it('flags isBug=true with the hard-signal spec score/severity', () => {
    const out = scoreState({ observed: tree(), hardSignals: ['HTTP_500'] });
    expect(out.isBug).toBe(true);
    expect(out.score).toBe(HARD_SIGNALS.HTTP_500.score);
    expect(out.severity).toBe('critical');
    expect(out.signalType).toBe('HTTP_500');
    expect(out.hardSignalOverride).toBe(true);
  });

  it('picks the highest-score signal when several fire', () => {
    const out = scoreState({ observed: tree(), hardSignals: ['ASSET_4XX', 'HTTP_500'] });
    expect(out.signalType).toBe('HTTP_500');
  });

  it('treats HTTP_4XX_NAV as flag-for-review (SPA routing makes it too ambiguous to auto-assert)', () => {
    const out = scoreState({ observed: tree(), hardSignals: ['HTTP_4XX_NAV'] });
    expect(out.isBug).toBe(false);
    expect(out.needsReview).toBe(true);
    expect(out.tier).toBe('flag-for-review');
  });

  it('treats DOM_FROZEN as flag-for-review (timing-fragile; never auto-asserts)', () => {
    const out = scoreState({ observed: tree(), hardSignals: ['DOM_FROZEN'] });
    expect(out.isBug).toBe(false);
    expect(out.needsReview).toBe(true);
    expect(out.tier).toBe('flag-for-review');
  });
});

describe('HARD_SIGNALS score ordering invariants', () => {
  it('CONSOLE_ERROR scores below STATE_WRONG_VALUE (data integrity > console noise)', () => {
    expect(HARD_SIGNALS.CONSOLE_ERROR.score).toBeLessThan(HARD_SIGNALS.STATE_WRONG_VALUE.score);
  });
});

describe('expectations.scoreState — two-tier authz verdicts (adversarial A1/A3)', () => {
  it('CROSS_ACCOUNT_LEAK is flag-for-review: even sentinel-grounded leaks need human confirmation', () => {
    const out = scoreState({ observed: tree(), hardSignals: ['CROSS_ACCOUNT_LEAK'] });
    expect(out.tier).toBe('flag-for-review');
    expect(out.isBug).toBe(false);
    expect(out.needsReview).toBe(true);
    expect(out.severity).toBe('critical');
    expect(out.signalType).toBe('CROSS_ACCOUNT_LEAK');
  });

  it('AUTHZ_UNCERTAIN is flag-for-review: never auto-asserts a bug', () => {
    const out = scoreState({ observed: tree(), hardSignals: ['AUTHZ_UNCERTAIN'] });
    expect(out.tier).toBe('flag-for-review');
    expect(out.isBug).toBe(false);
    expect(out.needsReview).toBe(true);
    expect(out.hardSignalOverride).toBe(true);
    expect(out.signalType).toBe('AUTHZ_UNCERTAIN');
  });

  it('a co-firing auto-assert signal always wins over AUTHZ_UNCERTAIN', () => {
    const out = scoreState({ observed: tree(), hardSignals: ['AUTHZ_UNCERTAIN', 'HTTP_500'] });
    expect(out.signalType).toBe('HTTP_500');
    expect(out.isBug).toBe(true);
    expect(out.needsReview).toBe(false);
  });

  it('AUTHZ_UNCERTAIN scores below every auto-assert signal', () => {
    const autoAssert = Object.entries(HARD_SIGNALS).filter(([, s]) => s.tier === 'auto-assert');
    for (const [type, spec] of autoAssert) {
      expect(spec.score, `${type} must outrank AUTHZ_UNCERTAIN`).toBeGreaterThan(
        HARD_SIGNALS.AUTHZ_UNCERTAIN.score,
      );
    }
  });
});

describe('expectations.scoreState — novelty (no hard signal)', () => {
  it('never declares a bug from novelty alone', () => {
    const prev = tree([{ role: 'button', name: 'A' }]);
    const curr = tree([{ role: 'button', name: 'A' }, { role: 'link', name: 'New' }]);
    const out = scoreState({ observed: curr, prevA11y: prev, hardSignals: [] });
    expect(out.isBug).toBe(false);
    expect(out.signalType).toBe(null);
    expect(out.score).toBeGreaterThan(0); // novel, but not a bug
  });

  it('is deterministic for identical inputs', () => {
    const prev = tree([{ role: 'button', name: 'A' }]);
    const curr = tree([{ role: 'button', name: 'A' }, { role: 'link', name: 'New' }]);
    const a = scoreState({ observed: curr, prevA11y: prev, hardSignals: [] });
    const b = scoreState({ observed: curr, prevA11y: prev, hardSignals: [] });
    expect(a).toEqual(b);
  });
});

describe('expectations.predict — retained for future synthesis', () => {
  beforeEach(() => complete.mockReset());

  it('skips the LLM when disabled', async () => {
    const out = await predict({ a11yTree: {}, action: {}, llmConfig: { enabled: false } });
    expect(out).toMatch(/LLM disabled/);
    expect(complete).not.toHaveBeenCalled();
  });
});
