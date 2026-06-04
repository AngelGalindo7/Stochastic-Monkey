import { describe, it, expect } from 'vitest';
import { pageEventsToHardSignals, isNoiseUrl } from '../../src/perception/httpSignals.js';

describe('httpSignals.pageEventsToHardSignals — HTTP-code-driven oracle', () => {
  it('5xx on any request is always a bug', () => {
    const { signals } = pageEventsToHardSignals([
      { type: 'HTTP_5XX', url: 'http://app/api/orders', status: 500, resourceType: 'fetch' },
    ]);
    expect(signals).toContain('HTTP_5XX');
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
});

describe('httpSignals.isNoiseUrl', () => {
  it('matches known telemetry/asset noise', () => {
    expect(isNoiseUrl('http://x/favicon.ico')).toBe(true);
    expect(isNoiseUrl('https://www.googletagmanager.com/gtm.js')).toBe(true);
    expect(isNoiseUrl('http://app/api/orders')).toBe(false);
  });
});
