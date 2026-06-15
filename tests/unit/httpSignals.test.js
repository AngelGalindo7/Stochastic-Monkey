import { describe, it, expect } from 'vitest';
import { pageEventsToHardSignals, isNoiseUrl } from '../../src/perception/httpSignals.js';

describe('httpSignals.pageEventsToHardSignals — HTTP-code-driven oracle', () => {
  it('a 500-class 5xx auto-asserts HTTP_500', () => {
    const { signals } = pageEventsToHardSignals([
      { type: 'HTTP_5XX', url: 'http://app/api/orders', status: 500, resourceType: 'fetch' },
    ]);
    expect(signals).toContain('HTTP_500');
  });

  it('4xx on a document request is a broken-route bug', () => {
    const { signals } = pageEventsToHardSignals([
      { type: 'HTTP_4XX', url: 'http://app/missing', status: 404, resourceType: 'document' },
    ]);
    expect(signals).toContain('HTTP_4XX_NAV');
  });

  it('4xx on a static asset is a broken-asset bug', () => {
    const { signals } = pageEventsToHardSignals([
      { type: 'HTTP_4XX', url: 'http://app/logo.png', status: 404, resourceType: 'image' },
    ]);
    expect(signals).toContain('ASSET_4XX');
  });

  it('4xx on an API (xhr/fetch) call is evidence, NOT a bug', () => {
    const { signals, evidence } = pageEventsToHardSignals([
      { type: 'HTTP_4XX', url: 'http://app/api/login', status: 400, resourceType: 'fetch' },
    ]);
    expect(signals).toHaveLength(0);
    expect(evidence.some((e) => e.signal === 'API_4XX')).toBe(true);
  });

  it('pageerror is a bug', () => {
    const { signals } = pageEventsToHardSignals([{ type: 'PAGEERROR', message: 'x is undefined' }]);
    expect(signals).toContain('PAGEERROR');
  });

  it('ignores 4xx on noise URLs (analytics, favicon)', () => {
    const { signals } = pageEventsToHardSignals([
      { type: 'HTTP_4XX', url: 'http://app/favicon.ico', status: 404, resourceType: 'image' },
      { type: 'HTTP_4XX', url: 'https://www.google-analytics.com/collect', status: 404, resourceType: 'xhr' },
    ]);
    expect(signals).toHaveLength(0);
  });

  it('a failed request (non-noise) is a bug', () => {
    const { signals } = pageEventsToHardSignals([
      { type: 'REQUEST_FAILED', url: 'http://app/api/data', reason: 'net::ERR' },
    ]);
    expect(signals).toContain('ASSET_4XX');
  });

  // Regression: fix(browser puppeteer) had to add resourceType capture because response events were missing it. Without resourceType every 4xx fell to evidence-only — real asset/nav bugs were silently suppressed. These tests show the classification branches by varying resourceType on identical events.
  it('4xx image URL: resourceType=image fires ASSET_4XX; resourceType=undefined goes to evidence only', () => {
    const { signals: withType } = pageEventsToHardSignals([
      { type: 'HTTP_4XX', url: 'http://app/logo.png', status: 404, resourceType: 'image' },
    ]);
    expect(withType).toContain('ASSET_4XX');

    const { signals: withoutType, evidence } = pageEventsToHardSignals([
      { type: 'HTTP_4XX', url: 'http://app/logo.png', status: 404, resourceType: undefined },
    ]);
    expect(withoutType).toHaveLength(0);
    expect(evidence.some((e) => e.signal === 'API_4XX')).toBe(true);
  });

  it('4xx page URL: resourceType=document fires HTTP_4XX_NAV; resourceType=undefined goes to evidence only', () => {
    const { signals: withType } = pageEventsToHardSignals([
      { type: 'HTTP_4XX', url: 'http://app/page', status: 404, resourceType: 'document' },
    ]);
    expect(withType).toContain('HTTP_4XX_NAV');

    const { signals: withoutType } = pageEventsToHardSignals([
      { type: 'HTTP_4XX', url: 'http://app/page', status: 404, resourceType: undefined },
    ]);
    expect(withoutType).toHaveLength(0);
  });

  it('a 500-class 5xx auto-asserts HTTP_500 regardless of resourceType', () => {
    for (const resourceType of ['fetch', undefined, 'document']) {
      const { signals } = pageEventsToHardSignals([
        { type: 'HTTP_5XX', url: 'http://app/api', status: 502, resourceType },
      ]);
      expect(signals, `status 502 / resourceType=${resourceType}`).toContain('HTTP_500');
    }
  });

  // Adversarial finding B10: 503 (rate limit / maintenance) and 504 (upstream
  // gateway timeout) are legitimate, retryable infra responses — not server
  // faults. They emit the HTTP_503_504 flag-for-review signal (and matching
  // evidence), never the HTTP_500 auto-assert, regardless of resourceType.
  it('emits HTTP_503_504 flag-for-review signal, never HTTP_500 auto-assert', () => {
    for (const status of [503, 504]) {
      for (const resourceType of ['fetch', undefined, 'document']) {
        const { signals, evidence } = pageEventsToHardSignals([
          { type: 'HTTP_5XX', url: 'http://app/api', status, resourceType },
        ]);
        const ctx = `status ${status} / resourceType=${resourceType}`;
        expect(signals, ctx).not.toContain('HTTP_500');
        expect(signals, ctx).toContain('HTTP_503_504');
        expect(signals, ctx).toHaveLength(1);
        expect(evidence.some((e) => e.signal === 'HTTP_503_504'), ctx).toBe(true);
      }
    }
  });
});

describe('httpSignals.isNoiseUrl', () => {
  it('matches known telemetry/asset noise', () => {
    expect(isNoiseUrl('http://x/favicon.ico')).toBe(true);
    expect(isNoiseUrl('https://www.googletagmanager.com/gtm.js')).toBe(true);
    expect(isNoiseUrl('http://app/api/orders')).toBe(false);
  });
});

describe('httpSignals — CONSOLE_ERROR signal', () => {
  const origin = 'http://app';

  it('real app error fires CONSOLE_ERROR', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: 'TypeError: Cannot read properties of undefined (reading map)', url: 'http://app/main.js' }],
      origin,
    );
    expect(signals).toContain('CONSOLE_ERROR');
  });

  it('[HMR] message is silenced', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: '[HMR] Cannot apply update', url: 'http://app/main.js' }],
      origin,
    );
    expect(signals).toHaveLength(0);
  });

  it('[vite] message is silenced', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: '[vite] failed to connect to HMR server', url: 'http://app/main.js' }],
      origin,
    );
    expect(signals).toHaveLength(0);
  });

  it('[webpack message is silenced', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: '[webpack HMR] Cannot apply update.', url: 'http://app/main.js' }],
      origin,
    );
    expect(signals).toHaveLength(0);
  });

  it('Download the React DevTools is silenced', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: 'Download the React DevTools for a better development experience', url: '' }],
      origin,
    );
    expect(signals).toHaveLength(0);
  });

  it('React 18 Warning: prefix is silenced', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: 'Warning: Each child in a list should have a unique "key" prop.', url: 'http://app/main.js' }],
      origin,
    );
    expect(signals).toHaveLength(0);
  });

  it('[Vue warn] is silenced', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: '[Vue warn]: Property "foo" was accessed during render but is not defined', url: 'http://app/main.js' }],
      origin,
    );
    expect(signals).toHaveLength(0);
  });

  it('third-party origin is filtered out when targetOrigin is set', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: 'Uncaught Error: stripe failed', url: 'https://js.stripe.com/v3/stripe.js' }],
      origin,
    );
    expect(signals).toHaveLength(0);
  });

  it('inline script (no url) is treated as first-party', () => {
    const { signals } = pageEventsToHardSignals(
      [{ type: 'CONSOLE_ERROR', message: 'ReferenceError: foo is not defined', url: '' }],
      origin,
    );
    expect(signals).toContain('CONSOLE_ERROR');
  });

  it('missing message field does not throw', () => {
    expect(() =>
      pageEventsToHardSignals([{ type: 'CONSOLE_ERROR' }], origin),
    ).not.toThrow();
  });
});

describe('httpSignals — DOM_FROZEN signal', () => {
  it('DOM_FROZEN event passes through as a hard signal', () => {
    const { signals, evidence } = pageEventsToHardSignals([{ type: 'DOM_FROZEN' }]);
    expect(signals).toContain('DOM_FROZEN');
    expect(evidence.some((e) => e.signal === 'DOM_FROZEN')).toBe(true);
  });
});
