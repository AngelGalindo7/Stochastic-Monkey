import { describe, it, expect, vi } from 'vitest';
import { runScroll } from '../../src/actions/scroll.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePage(evaluateImpl = async () => {}) {
  return { raw: { evaluate: vi.fn().mockImplementation(evaluateImpl) } };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('runScroll — success', () => {
  it('returns { success: true, dy, latencyMs }', async () => {
    const page = makePage();
    const r = await runScroll({ page, rng: () => 0.5 });
    expect(r.success).toBe(true);
    expect(typeof r.dy).toBe('number');
    expect(typeof r.latencyMs).toBe('number');
  });

  it('calls page.raw.evaluate with scrollBy', async () => {
    const page = makePage();
    await runScroll({ page, rng: () => 0.5 });
    expect(page.raw.evaluate).toHaveBeenCalledTimes(1);
    const [fn, dy] = page.raw.evaluate.mock.calls[0];
    expect(typeof fn).toBe('function');
    expect(typeof dy).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// dy formula: Math.floor((rng() - 0.3) * 1200)
// ---------------------------------------------------------------------------

describe('runScroll — dy calculation', () => {
  it('computes a positive dy (scroll down) when rng() > 0.3', async () => {
    const page = makePage();
    // rng() = 0.5 → (0.5 - 0.3) * 1200 = 240
    const r = await runScroll({ page, rng: () => 0.5 });
    expect(r.dy).toBe(240);
  });

  it('computes a negative dy (scroll up) when rng() < 0.3', async () => {
    const page = makePage();
    // rng() = 0.1 → (0.1 - 0.3) * 1200 = -240
    const r = await runScroll({ page, rng: () => 0.1 });
    expect(r.dy).toBe(-240);
  });

  it('computes dy = 0 when rng() = 0.3', async () => {
    const page = makePage();
    // rng() = 0.3 → (0.3 - 0.3) * 1200 = 0
    const r = await runScroll({ page, rng: () => 0.3 });
    expect(r.dy).toBe(0);
  });

  it('computes maximum positive dy when rng() = 1', async () => {
    const page = makePage();
    // rng() = 1 → (1 - 0.3) * 1200 = 840
    const r = await runScroll({ page, rng: () => 1 });
    expect(r.dy).toBe(840);
  });

  it('computes maximum negative dy when rng() = 0', async () => {
    const page = makePage();
    // rng() = 0 → (0 - 0.3) * 1200 = -360
    const r = await runScroll({ page, rng: () => 0 });
    expect(r.dy).toBe(-360);
  });

  it('passes the computed dy to page.raw.evaluate', async () => {
    const page = makePage();
    await runScroll({ page, rng: () => 0.5 });
    const [, dyArg] = page.raw.evaluate.mock.calls[0];
    expect(dyArg).toBe(240);
  });
});

// ---------------------------------------------------------------------------
// Error recovery
// ---------------------------------------------------------------------------

describe('runScroll — error recovery', () => {
  it('returns { success: false, error } when evaluate throws', async () => {
    const page = { raw: { evaluate: vi.fn().mockRejectedValue(new Error('Frame detached')) } };
    const r = await runScroll({ page, rng: () => 0.5 });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Frame detached');
  });

  it('includes latencyMs even on failure', async () => {
    const page = { raw: { evaluate: vi.fn().mockRejectedValue(new Error('Frame detached')) } };
    const r = await runScroll({ page, rng: () => 0.5 });
    expect(typeof r.latencyMs).toBe('number');
  });
});
