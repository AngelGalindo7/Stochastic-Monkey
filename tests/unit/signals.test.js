import { describe, it, expect, vi } from 'vitest';
import {
  CONSOLE_ERROR_DENYLIST,
  isFirstPartyConsoleError,
  pageEventsToHardSignals,
} from '../../src/perception/httpSignals.js';
import { checkDomFrozen } from '../../src/agent/signals.js';

const ORIGIN = 'https://example.com';

// ── CONSOLE_ERROR_DENYLIST ──────────────────────────────────────────────────

describe('CONSOLE_ERROR_DENYLIST', () => {
  const blocked = [
    'ResizeObserver loop limit exceeded',
    'net::ERR_ABORTED 404',
    'chrome-extension://abc/content.js error',
    'moz-extension://xyz/inject.js threw',
    'googletagmanager.com script error',
    '[Violation] Added non-passive event listener',
    'Intervention: ignored attempt to cancel a touchmove',
  ];

  it.each(blocked)('blocks: %s', (msg) => {
    expect(CONSOLE_ERROR_DENYLIST.some((re) => re.test(msg))).toBe(true);
  });

  it('does not block a genuine app error', () => {
    expect(CONSOLE_ERROR_DENYLIST.some((re) => re.test('TypeError: Cannot read properties of undefined (reading "map")'))).toBe(false);
  });
});

// ── isFirstPartyConsoleError ────────────────────────────────────────────────

describe('isFirstPartyConsoleError', () => {
  it('accepts an event from the same origin', () => {
    expect(isFirstPartyConsoleError({ url: 'https://example.com/app.js' }, ORIGIN)).toBe(true);
  });

  it('rejects an event from a different origin', () => {
    expect(isFirstPartyConsoleError({ url: 'https://cdn.third-party.com/lib.js' }, ORIGIN)).toBe(false);
  });

  it('rejects a chrome-extension URL', () => {
    expect(isFirstPartyConsoleError({ url: 'chrome-extension://abcdef/content.js' }, ORIGIN)).toBe(false);
  });

  it('rejects a moz-extension URL', () => {
    expect(isFirstPartyConsoleError({ url: 'moz-extension://abcdef/content.js' }, ORIGIN)).toBe(false);
  });

  it('treats an inline event (no url) as first-party', () => {
    expect(isFirstPartyConsoleError({ url: undefined }, ORIGIN)).toBe(true);
    expect(isFirstPartyConsoleError({}, ORIGIN)).toBe(true);
  });

  it('treats a malformed URL as non-first-party', () => {
    expect(isFirstPartyConsoleError({ url: 'not-a-url' }, ORIGIN)).toBe(false);
  });
});

// ── pageEventsToHardSignals ─────────────────────────────────────────────────

describe('pageEventsToHardSignals', () => {
  it('emits PAGEERROR', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'PAGEERROR', message: 'Uncaught TypeError' }],
      ORIGIN,
    );
    expect(signals).toContain('PAGEERROR');
  });

  it('emits HTTP_5XX', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'HTTP_5XX', status: 500, url: 'https://example.com/api' }],
      ORIGIN,
    );
    expect(signals).toContain('HTTP_5XX');
  });

  it('emits ASSET_4XX for non-noise requests', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'HTTP_4XX', status: 404, url: 'https://example.com/missing.js', resourceType: 'script' }],
      ORIGIN,
    );
    expect(signals).toContain('ASSET_4XX');
  });

  it('suppresses ASSET_4XX for noise URLs', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'HTTP_4XX', status: 404, url: 'https://google-analytics.com/collect' }],
      ORIGIN,
    );
    expect(signals).not.toContain('ASSET_4XX');
  });

  it('emits CONSOLE_ERROR for a genuine first-party error', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: 'TypeError: x is not a function', url: 'https://example.com/app.js' }],
      ORIGIN,
    );
    expect(signals).toContain('CONSOLE_ERROR');
  });

  it('suppresses CONSOLE_ERROR for denylist-matched messages', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: 'ResizeObserver loop limit exceeded', url: 'https://example.com/app.js' }],
      ORIGIN,
    );
    expect(signals).not.toContain('CONSOLE_ERROR');
  });

  it('suppresses CONSOLE_ERROR from extension URL', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: 'Something failed', url: 'chrome-extension://abc/content.js' }],
      ORIGIN,
    );
    expect(signals).not.toContain('CONSOLE_ERROR');
  });

  it('suppresses CONSOLE_ERROR from third-party origin', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: 'Script error.', url: 'https://cdn.other.com/lib.js' }],
      ORIGIN,
    );
    expect(signals).not.toContain('CONSOLE_ERROR');
  });

  it('suppresses inline analytics noise via denylist', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: 'googletagmanager.com/gtm.js failed', url: undefined }],
      ORIGIN,
    );
    expect(signals).not.toContain('CONSOLE_ERROR');
  });
});

// ── checkDomFrozen ──────────────────────────────────────────────────────────

describe('checkDomFrozen', () => {
  it('returns false when DOM has content', async () => {
    const page = { raw: { evaluate: vi.fn().mockResolvedValue(false) } };
    expect(await checkDomFrozen(page)).toBe(false);
  });

  it('returns true when DOM is empty (no settle)', async () => {
    const page = { raw: { evaluate: vi.fn().mockResolvedValue(true) } };
    expect(await checkDomFrozen(page, { settleMs: 0 })).toBe(true);
  });

  it('returns false when DOM fills in after settle', async () => {
    const page = { raw: { evaluate: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) } };
    expect(await checkDomFrozen(page, { settleMs: 1 })).toBe(false);
  });

  it('returns true when DOM stays empty after settle', async () => {
    const page = { raw: { evaluate: vi.fn().mockResolvedValue(true) } };
    expect(await checkDomFrozen(page, { settleMs: 1 })).toBe(true);
  });

  it('returns false if evaluate throws (detached frame)', async () => {
    const page = { raw: { evaluate: vi.fn().mockRejectedValue(new Error('detached')) } };
    expect(await checkDomFrozen(page)).toBe(false);
  });
});
