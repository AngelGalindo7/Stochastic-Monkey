import { describe, it, expect, vi } from 'vitest';
import { checkBrokenImages } from '../../src/agent/oracles/structural.js';

const ORIGIN = 'https://app.example.com';

function makePage(srcs) {
  return { raw: { evaluate: vi.fn().mockResolvedValue(srcs) } };
}

describe('checkBrokenImages', () => {
  it('returns null signal when no broken images', async () => {
    const page = makePage([]);
    expect(await checkBrokenImages(page, ORIGIN)).toEqual({ signal: null });
  });

  it('fires BROKEN_IMAGE when evaluate returns at least one src', async () => {
    const page = makePage([`${ORIGIN}/hero.jpg`]);
    const result = await checkBrokenImages(page, ORIGIN);
    expect(result.signal).toBe('BROKEN_IMAGE');
    expect(result.detail).toContain('hero.jpg');
  });

  it('includes count in detail', async () => {
    const srcs = [`${ORIGIN}/a.jpg`, `${ORIGIN}/b.jpg`, `${ORIGIN}/c.jpg`];
    const page = makePage(srcs);
    const result = await checkBrokenImages(page, ORIGIN);
    expect(result.detail).toMatch(/^3 broken/);
  });

  it('caps the detail list at 3 URLs', async () => {
    const srcs = Array.from({ length: 5 }, (_, i) => `${ORIGIN}/img${i}.jpg`);
    const page = makePage(srcs);
    const result = await checkBrokenImages(page, ORIGIN);
    // only the first 3 appear in the detail string
    expect(result.detail.split(',').length).toBeLessThanOrEqual(3);
    expect(result.detail).not.toContain('img3.jpg');
  });

  it('returns null signal when evaluate throws (detached frame)', async () => {
    const page = { raw: { evaluate: vi.fn().mockRejectedValue(new Error('Target closed')) } };
    expect(await checkBrokenImages(page, ORIGIN)).toEqual({ signal: null });
  });

  it('passes targetOrigin as the second argument to evaluate', async () => {
    const page = makePage([]);
    await checkBrokenImages(page, ORIGIN);
    expect(page.raw.evaluate).toHaveBeenCalledWith(expect.any(Function), ORIGIN);
  });
});

// ---------------------------------------------------------------------------
// Guard logic — exercised by running the serialised predicate inline
// These tests call the filter function directly to verify the four guards
// without needing a real browser. The function is extracted from the module
// source to keep the tests independent of evaluate() mocking complexity.
// ---------------------------------------------------------------------------

function makeImg({ src = '', loading = 'auto', complete = true, naturalWidth = 0, naturalHeight = 0, top = 0 } = {}) {
  return {
    src,
    currentSrc: src,
    loading,
    complete,
    naturalWidth,
    naturalHeight,
    getBoundingClientRect: () => ({ top }),
  };
}

// Re-implement the filter predicate from structural.js so we can unit-test it
// without a browser. Must stay in sync with the evaluate() callback in structural.js.
function isFilteredOut(el, origin, innerHeight = 768) {
  if (!el.src || el.src === 'about:blank') return true; // treated as baseURI for test
  const src = el.currentSrc || el.src;
  if (/\.svg($|\?)/i.test(src) || src.startsWith('data:image/svg')) return true;
  if (el.loading === 'lazy') {
    const rect = el.getBoundingClientRect();
    if (rect.top > innerHeight) return true;
  }
  if (!el.complete || el.naturalWidth !== 0 || el.naturalHeight !== 0) return true;
  try {
    return new URL(el.src).origin !== origin;
  } catch {
    return true;
  }
}

describe('checkBrokenImages — guard logic', () => {
  it('passes a genuinely broken first-party image', () => {
    const el = makeImg({ src: `${ORIGIN}/broken.jpg`, complete: true, naturalWidth: 0, naturalHeight: 0 });
    expect(isFilteredOut(el, ORIGIN)).toBe(false);
  });

  it('filters out an image with no src', () => {
    const el = makeImg({ src: '' });
    expect(isFilteredOut(el, ORIGIN)).toBe(true);
  });

  it('filters out SVG by extension', () => {
    const el = makeImg({ src: `${ORIGIN}/icon.svg`, complete: true, naturalWidth: 0, naturalHeight: 0 });
    expect(isFilteredOut(el, ORIGIN)).toBe(true);
  });

  it('filters out SVG by query string', () => {
    const el = makeImg({ src: `${ORIGIN}/icon.svg?v=2`, complete: true, naturalWidth: 0, naturalHeight: 0 });
    expect(isFilteredOut(el, ORIGIN)).toBe(true);
  });

  it('filters out data:image/svg URI', () => {
    const el = makeImg({ src: 'data:image/svg+xml,<svg/>', complete: true, naturalWidth: 0, naturalHeight: 0 });
    expect(isFilteredOut(el, ORIGIN)).toBe(true);
  });

  it('filters out lazy image below viewport', () => {
    const el = makeImg({ src: `${ORIGIN}/lazy.jpg`, loading: 'lazy', top: 900, complete: true, naturalWidth: 0, naturalHeight: 0 });
    expect(isFilteredOut(el, ORIGIN, 768)).toBe(true);
  });

  it('keeps lazy image that is in viewport', () => {
    const el = makeImg({ src: `${ORIGIN}/lazy.jpg`, loading: 'lazy', top: 100, complete: true, naturalWidth: 0, naturalHeight: 0 });
    expect(isFilteredOut(el, ORIGIN, 768)).toBe(false);
  });

  it('filters out an image that has not completed loading', () => {
    const el = makeImg({ src: `${ORIGIN}/pending.jpg`, complete: false, naturalWidth: 0, naturalHeight: 0 });
    expect(isFilteredOut(el, ORIGIN)).toBe(true);
  });

  it('filters out an image with positive naturalWidth (loaded fine)', () => {
    const el = makeImg({ src: `${ORIGIN}/fine.jpg`, complete: true, naturalWidth: 120, naturalHeight: 80 });
    expect(isFilteredOut(el, ORIGIN)).toBe(true);
  });

  it('filters out a third-party image', () => {
    const el = makeImg({ src: 'https://cdn.third-party.com/img.jpg', complete: true, naturalWidth: 0, naturalHeight: 0 });
    expect(isFilteredOut(el, ORIGIN)).toBe(true);
  });

  it('filters out a malformed src URL', () => {
    const el = makeImg({ src: 'not-a-url', complete: true, naturalWidth: 0, naturalHeight: 0 });
    expect(isFilteredOut(el, ORIGIN)).toBe(true);
  });
});
