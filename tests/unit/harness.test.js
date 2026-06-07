import { describe, it, expect } from 'vitest';
import { slugify } from '../../harness/lib/slug.js';
import { makeDenylist } from '../../harness/lib/denylist.js';
import { isSettled } from '../../harness/lib/manifest.js';
import { summarize, renderReport } from '../../harness/lib/aggregate.js';
import { hostOf } from '../../harness/lib/rateLimiter.js';

describe('slugify', () => {
  it('turns a url into a flat host slug', () => {
    expect(slugify('https://my-app.lovable.app/path?q=1')).toBe('my-app-lovable-app');
  });
  it('accepts a bare host', () => {
    expect(slugify('example.com')).toBe('example-com');
  });
  it('falls back to "target" for empty-ish input', () => {
    expect(slugify('...')).toBe('target');
  });
});

describe('denylist', () => {
  const isDenied = makeDenylist(['blocked.example.com']);
  it('denies health/finance/gov/edu hosts', () => {
    expect(isDenied('https://my-health-clinic.com').denied).toBe(true);
    expect(isDenied('https://first.bank.com').denied).toBe(true);
    expect(isDenied('https://agency.gov').denied).toBe(true);
    expect(isDenied('https://college.edu').denied).toBe(true);
  });
  it('allows ordinary app hosts', () => {
    expect(isDenied('https://cool-app.lovable.app').denied).toBe(false);
  });
  it('honors the extra deny-file list', () => {
    expect(isDenied('https://blocked.example.com').denied).toBe(true);
  });
  it('denies unparseable urls', () => {
    expect(isDenied('not a url').denied).toBe(true);
  });
});

describe('manifest.isSettled', () => {
  it('treats done/timeout/skipped as settled', () => {
    expect(isSettled({ status: 'done' })).toBe(true);
    expect(isSettled({ status: 'timeout' })).toBe(true);
    expect(isSettled({ status: 'skipped' })).toBe(true);
  });
  it('treats failed/running/undefined as not settled (retryable)', () => {
    expect(isSettled({ status: 'failed' })).toBe(false);
    expect(isSettled({ status: 'running' })).toBe(false);
    expect(isSettled(undefined)).toBeFalsy();
  });
});

describe('rateLimiter.hostOf', () => {
  it('extracts the full host', () => {
    expect(hostOf('https://a.b.lovable.app/x')).toBe('a.b.lovable.app');
  });
});

describe('aggregate.summarize', () => {
  const findings = [
    { slug: 'a', url: 'https://a', platform: 'lovable', severity: 'critical', signal: 'HTTP_5XX' },
    { slug: 'a', url: 'https://a', platform: 'lovable', severity: 'medium', signal: 'ASSET_4XX' },
    { slug: 'b', url: 'https://b', platform: 'bolt', severity: 'medium', signal: 'ASSET_4XX' },
  ];
  const manifest = new Map([
    ['a', { slug: 'a', status: 'done' }],
    ['b', { slug: 'b', status: 'timeout' }],
    ['c', { slug: 'c', status: 'skipped' }],
  ]);

  it('counts by severity and signal with distinct-target dedup', () => {
    const s = summarize(findings, manifest);
    expect(s.bySeverity).toEqual({ critical: 1, medium: 2 });
    expect(s.bySignal.ASSET_4XX).toEqual({ findings: 2, distinctTargets: 2 });
    expect(s.bySignal.HTTP_5XX).toEqual({ findings: 1, distinctTargets: 1 });
  });
  it('counts targets with findings vs manifest size', () => {
    const s = summarize(findings, manifest);
    expect(s.totals.findings).toBe(3);
    expect(s.totals.targetsWithFindings).toBe(2);
    expect(s.totals.manifestTargets).toBe(3);
  });
  it('rolls up manifest status counts', () => {
    const s = summarize(findings, manifest);
    expect(s.statusCounts).toEqual({ done: 1, timeout: 1, skipped: 1 });
  });
  it('disclosure queue holds only critical/high', () => {
    const s = summarize(findings, manifest);
    expect(s.disclosure).toHaveLength(1);
    expect(s.disclosure[0].signal).toBe('HTTP_5XX');
  });
  it('renderReport emits the key sections', () => {
    const md = renderReport(summarize(findings, manifest), { generatedAt: 'X' });
    expect(md).toMatch(/# Mass-test report/);
    expect(md).toMatch(/## Findings by severity/);
    expect(md).toMatch(/## Disclosure queue/);
    expect(md).toMatch(/HTTP_5XX/);
  });
});
