import { describe, it, expect, vi } from 'vitest';
import seedrandom from 'seedrandom';
import { runNavigate } from '../../src/actions/navigate.js';

function makePage(hrefs) {
  return {
    raw: {
      $$eval: vi.fn().mockResolvedValue(hrefs),
      goto: vi.fn().mockResolvedValue(undefined),
    },
  };
}

const LINKS = [
  'http://localhost:3000/a',
  'http://localhost:3000/b',
  'http://localhost:3000/c',
  'https://external.com/x',
];

const base = { allowedDomains: ['localhost'], currentUrl: 'http://localhost:3000/' };

describe('runNavigate — seeded determinism', () => {
  it('picks the same internal link for the same seed', async () => {
    const a = await runNavigate({ page: makePage(LINKS), ...base, rng: seedrandom('s') });
    const b = await runNavigate({ page: makePage(LINKS), ...base, rng: seedrandom('s') });
    expect(a.success).toBe(true);
    expect(a.navigatedTo).toBe(b.navigatedTo);
  });

  it('only navigates to internal (allowedDomains) links', async () => {
    const page = makePage(LINKS);
    const r = await runNavigate({ page, ...base, rng: seedrandom('s') });
    expect(r.navigatedTo.startsWith('http://localhost:3000/')).toBe(true);
    expect(page.raw.goto).toHaveBeenCalledWith(r.navigatedTo, expect.any(Object));
  });

  it('never consults Math.random (uses the seeded rng)', async () => {
    const spy = vi.spyOn(Math, 'random');
    await runNavigate({ page: makePage(LINKS), ...base, rng: seedrandom('s') });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reports no internal links when none match the allowed domains', async () => {
    const r = await runNavigate({ page: makePage(['https://external.com/x']), ...base, rng: seedrandom('s') });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no internal links/);
  });
});
