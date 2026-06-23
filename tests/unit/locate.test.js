import { describe, it, expect, vi } from 'vitest';
import { queryByXPath } from '../../src/actions/locate.js';

// ---------------------------------------------------------------------------
// Guard: xpath must start with '//'
// ---------------------------------------------------------------------------

describe('queryByXPath — xpath guard', () => {
  it('throws when xpath does not start with "//"', () => {
    const page = { engine: 'puppeteer', raw: { $$: vi.fn() } };
    expect(() => queryByXPath(page, 'button')).toThrow(/must start with '\/\/'/);
  });

  it('throws when xpath starts with a single slash', () => {
    const page = { engine: 'puppeteer', raw: { $$: vi.fn() } };
    expect(() => queryByXPath(page, '/html/body/button')).toThrow(/must start with '\/\/'/);
  });

  it('throws when xpath is an empty string', () => {
    const page = { engine: 'puppeteer', raw: { $$: vi.fn() } };
    expect(() => queryByXPath(page, '')).toThrow(/must start with '\/\/'/);
  });

  it('does not throw when xpath starts with "//"', () => {
    const page = { engine: 'puppeteer', raw: { $$: vi.fn().mockReturnValue([]) } };
    expect(() => queryByXPath(page, '//button')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Engine dispatch — Playwright
// ---------------------------------------------------------------------------

describe('queryByXPath — Playwright engine', () => {
  it('calls page.raw.$$(xpath) directly for playwright engine', () => {
    const $$ = vi.fn().mockReturnValue(['el']);
    const page = { engine: 'playwright', raw: { $$: $$ } };
    queryByXPath(page, '//button');
    expect($$).toHaveBeenCalledWith('//button');
  });

  it('does not add an xpath/ prefix for playwright', () => {
    const $$ = vi.fn().mockReturnValue([]);
    const page = { engine: 'playwright', raw: { $$: $$ } };
    queryByXPath(page, '//input[@name="email"]');
    expect($$).toHaveBeenCalledWith('//input[@name="email"]');
    expect($$).not.toHaveBeenCalledWith(expect.stringContaining('xpath/'));
  });
});

// ---------------------------------------------------------------------------
// Engine dispatch — Puppeteer / Lightpanda (everything else)
// ---------------------------------------------------------------------------

describe('queryByXPath — Puppeteer engine', () => {
  it('prefixes xpath with "xpath/." for non-playwright engines', () => {
    const $$ = vi.fn().mockReturnValue(['el']);
    const page = { engine: 'puppeteer', raw: { $$: $$ } };
    queryByXPath(page, '//button');
    expect($$).toHaveBeenCalledWith('xpath/.//button');
  });

  it('uses the xpath/ prefix when engine is undefined', () => {
    const $$ = vi.fn().mockReturnValue([]);
    const page = { engine: undefined, raw: { $$: $$ } };
    queryByXPath(page, '//a');
    expect($$).toHaveBeenCalledWith('xpath/.//a');
  });

  it('forwards the return value from page.raw.$$', () => {
    const sentinel = [{ click: vi.fn() }];
    const page = { engine: 'puppeteer', raw: { $$: vi.fn().mockReturnValue(sentinel) } };
    const result = queryByXPath(page, '//button');
    expect(result).toBe(sentinel);
  });
});
