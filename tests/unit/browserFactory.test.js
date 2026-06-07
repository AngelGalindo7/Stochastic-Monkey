import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/browser/puppeteer.js', () => ({
  launchPuppeteer: vi.fn(async () => ({
    kind: 'puppeteer',
    raw: {},
    newPage: vi.fn(),
    close: vi.fn(async () => {}),
  })),
}));
vi.mock('../../src/browser/playwright.js', () => ({
  launchPlaywright: vi.fn(async () => ({
    kind: 'playwright',
    raw: {},
    newPage: vi.fn(),
    close: vi.fn(async () => {}),
  })),
}));
// Lightpanda is not available on Windows; mock to avoid platform guard errors.
vi.mock('../../src/browser/lightpanda.js', () => {
  class NotImplementedError extends Error {
    constructor(msg, decision) {
      super(msg);
      this.decision = decision;
    }
  }
  return {
    launchLightpanda: vi.fn(async () => {
      throw new NotImplementedError('not available', '002');
    }),
    NotImplementedError,
  };
});

import { isSpaCrash, createBrowser, forwardEventsTo } from '../../src/browser/browserFactory.js';
import { launchPuppeteer } from '../../src/browser/puppeteer.js';
import { launchPlaywright } from '../../src/browser/playwright.js';

beforeEach(() => {
  launchPuppeteer.mockClear();
  launchPlaywright.mockClear();
});

// Regression: the fallback guard must NOT trigger on app-level errors (4xx,
// missing element). Only CDP/WebSocket/protocol crashes should trigger it.
// Bug pattern: if isSpaCrash matches too broadly, legitimate 4xx signals get
// silently swallowed by a fallback instead of becoming bug reports.
describe('browserFactory.isSpaCrash — crash vs app-error boundary', () => {
  it('matches Protocol error', () => {
    expect(isSpaCrash(new Error('Protocol error: Target closed'))).toBe(true);
  });

  it('matches Session closed', () => {
    expect(isSpaCrash(new Error('Session closed unexpectedly'))).toBe(true);
  });

  it('matches Execution context destroyed', () => {
    expect(isSpaCrash(new Error('Execution context was destroyed'))).toBe(true);
  });

  it('matches WebSocket closed', () => {
    expect(isSpaCrash(new Error('WebSocket closed: 1006'))).toBe(true);
  });

  it('matches CDP disconnect', () => {
    expect(isSpaCrash(new Error('CDP disconnect: connection lost'))).toBe(true);
  });

  it('matches goto timeout', () => {
    expect(isSpaCrash(new Error('goto timeout exceeded'))).toBe(true);
  });

  it('matches Navigation failed', () => {
    expect(isSpaCrash(new Error('Navigation failed: ERR_CONNECTION_REFUSED'))).toBe(true);
  });

  it('matches evaluate error', () => {
    expect(isSpaCrash(new Error('evaluate error: context gone'))).toBe(true);
  });

  it('matches Cannot find context', () => {
    expect(isSpaCrash(new Error('Cannot find context with id 17'))).toBe(true);
  });

  // These must NOT match — app-level errors should produce bug signals, not
  // a silent engine fallback that discards the signal.
  it('does NOT match 404 app errors', () => {
    expect(isSpaCrash(new Error('404: Not Found at /api/items'))).toBe(false);
  });

  it('does NOT match "Element not found"', () => {
    expect(isSpaCrash(new Error('Element not found: button.submit'))).toBe(false);
  });

  it('does NOT match generic JS errors', () => {
    expect(isSpaCrash(new Error('TypeError: cannot read property of null'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSpaCrash(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSpaCrash(undefined)).toBe(false);
  });
});

// Regression: engine dispatch must be respected — PR wired browser.engine into
// createBrowser, a mis-wiring would silently use the wrong engine and hide
// Playwright-specific bugs.
describe('browserFactory.createBrowser — engine dispatch', () => {
  it('routes engine=playwright to launchPlaywright', async () => {
    const b = await createBrowser({ engine: 'playwright' });
    expect(launchPlaywright).toHaveBeenCalledOnce();
    expect(launchPuppeteer).not.toHaveBeenCalled();
    expect(b.kind).toBe('playwright');
  });

  it('routes engine=puppeteer to launchPuppeteer', async () => {
    const b = await createBrowser({ engine: 'puppeteer', preferLightpanda: false });
    expect(launchPuppeteer).toHaveBeenCalledOnce();
    expect(launchPlaywright).not.toHaveBeenCalled();
    expect(b.kind).toBe('puppeteer');
  });

  it('passes headful and userDataDir through to the launcher', async () => {
    await createBrowser({ engine: 'playwright', headful: true, userDataDir: '/tmp/session' });
    expect(launchPlaywright).toHaveBeenCalledWith(
      expect.objectContaining({ headful: true, userDataDir: '/tmp/session' }),
    );
  });

  it('passes storageState through to playwright launcher', async () => {
    await createBrowser({ engine: 'playwright', storageState: '/tmp/auth.json' });
    expect(launchPlaywright).toHaveBeenCalledWith(
      expect.objectContaining({ storageState: '/tmp/auth.json' }),
    );
  });

  // Win32 guard: on Windows, lightpanda is always bypassed and puppeteer is
  // used instead. Even if preferLightpanda=true, the result should be puppeteer
  // (the lightpanda mock throws NotImplementedError, simulating the guard).
  it('falls back to puppeteer when lightpanda is unavailable (win32 / no CDP URL)', async () => {
    const b = await createBrowser({ engine: 'puppeteer', preferLightpanda: true });
    expect(launchPuppeteer).toHaveBeenCalled();
    expect(b.kind).toBe('puppeteer');
  });
});

// Regression: forwardEventsTo patches srcArr.push to fan out events to the fallback backing array. If this breaks, events from the post-fallback puppeteer page are silently lost — bug signals go unfiled.
describe('browserFactory.forwardEventsTo — push fan-out to backing array', () => {
  it('srcArr receives items after forwardEventsTo', () => {
    const srcArr = [];
    const dstArr = [];
    forwardEventsTo(srcArr, dstArr);
    srcArr.push('a');
    expect(dstArr).toContain('a');
  });

  it('srcArr still holds its own items and forwards to dstArr', () => {
    const srcArr = [];
    const dstArr = [];
    forwardEventsTo(srcArr, dstArr);
    srcArr.push('b');
    expect(srcArr).toContain('b');
    expect(dstArr).toContain('b');
  });

  it('items pushed before forwardEventsTo are NOT retroactively forwarded', () => {
    const srcArr = ['pre'];
    const dstArr = [];
    forwardEventsTo(srcArr, dstArr);
    expect(dstArr).toHaveLength(0);
    srcArr.push('after');
    expect(dstArr).toEqual(['after']);
    expect(dstArr).not.toContain('pre');
  });

  it('multiple pushes all forward', () => {
    const srcArr = [];
    const dstArr = [];
    forwardEventsTo(srcArr, dstArr);
    srcArr.push('x');
    srcArr.push('y');
    srcArr.push('z');
    expect(dstArr).toEqual(['x', 'y', 'z']);
  });

});

