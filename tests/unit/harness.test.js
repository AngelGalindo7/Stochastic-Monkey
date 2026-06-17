import { describe, it, expect } from 'vitest';
import { slugify } from '../../harness/lib/slug.js';
import { makeDenylist } from '../../harness/lib/denylist.js';
import { isSettled } from '../../harness/lib/manifest.js';
import { summarize, renderReport, renderDashboardHtml } from '../../harness/lib/aggregate.js';
import { hostOf } from '../../harness/lib/rateLimiter.js';
import { fingerprint, decodeJwtPayload, extractScriptSrcs } from '../../harness/lib/fingerprint.js';
import {
  parseCrtSh, crtShUrl,
  parseHackerTarget, hackerTargetUrl,
  parseWaybackCdx, waybackCdxUrl,
  parseRapidDns, rapidDnsUrl,
} from '../../harness/lib/discover.js';
import { createQueue, claim, complete, reap, preset, stats } from '../../harness/lib/queue.js';

// Build a fake Supabase anon JWT (header.payload.signature, base64url).
function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig_${'x'.repeat(20)}`;
}

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
  it('does not deny compound-word hostnames that merely contain a sensitive substring', () => {
    // "mentalhealth" contains "health" but is not a health-service domain
    expect(isDenied('https://mentalhealth-tracker.lovable.app').denied).toBe(false);
    // "cryptography" contains "crypto" but is not a finance site
    expect(isDenied('https://cryptography-tool.lovable.app').denied).toBe(false);
    // "banksy" contains "bank" but is not a bank
    expect(isDenied('https://banksy-art.lovable.app').denied).toBe(false);
    // "therapist" starts with "therap" but is embedded — not a standalone segment
    expect(isDenied('https://therapistfinder.lovable.app').denied).toBe(false);
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

  it('renderDashboardHtml produces a self-contained page with the data', () => {
    const html = renderDashboardHtml(summarize(findings, manifest), findings, { generatedAt: 'X' });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<style>'); // inline CSS — no CDN
    expect(html).not.toMatch(/https?:\/\/[^"]*\.(css|js)"/); // no external assets
    expect(html).toContain('HTTP_5XX');
    expect(html).toContain('Total findings');
    expect(html).toContain('https://a'); // a finding url
  });

  it('escapes HTML in finding fields', () => {
    const evil = [{ slug: 'x', url: 'https://x/<script>alert(1)</script>', platform: 'p', severity: 'low', signal: 'S' }];
    const html = renderDashboardHtml(summarize(evil, new Map()), evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('fingerprint', () => {
  it('decodes a JWT payload', () => {
    const jwt = fakeJwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon' });
    expect(decodeJwtPayload(jwt)).toMatchObject({ role: 'anon', ref: 'abcdefghijklmnop' });
  });

  it('detects a Supabase anon JWT and derives the project URL from ref', () => {
    const jwt = fakeJwt({ iss: 'supabase', ref: 'abcdefghijklmnop', role: 'anon' });
    const fp = fingerprint({ url: 'https://app.lovable.app', scripts: [`const KEY="${jwt}";`] });
    expect(fp.signals).toContain('supabase-anon-jwt');
    expect(fp.anonKey).toBe(jwt);
    expect(fp.supabaseUrl).toBe('https://abcdefghijklmnop.supabase.co');
    expect(fp.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('tags the lovable platform from markers', () => {
    const fp = fingerprint({ url: 'https://x.lovable.app', html: '<script src="https://gptengineer.app/x.js"></script>' });
    expect(fp.platform).toBe('lovable');
    expect(fp.signals).toContain('marker:lovable');
  });

  it('labels a supabase-only app as supabase-app', () => {
    const fp = fingerprint({ url: 'https://x', html: 'fetch("https://abcdefghijklmnop.supabase.co/rest/v1/users")' });
    expect(fp.platform).toBe('supabase-app');
    expect(fp.signals).toEqual(expect.arrayContaining(['supabase-url', 'postgrest']));
  });

  it('stays unknown + low confidence for a plain site', () => {
    const fp = fingerprint({ url: 'https://example.com', html: '<h1>hello</h1>' });
    expect(fp.platform).toBe('unknown');
    expect(fp.confidence).toBe(0);
  });

  it('extracts and resolves script srcs', () => {
    const srcs = extractScriptSrcs('<script src="/assets/index-abc.js"></script><script src="https://cdn.x/y.js"></script>', 'https://app.lovable.app/');
    expect(srcs).toEqual(['https://app.lovable.app/assets/index-abc.js', 'https://cdn.x/y.js']);
  });
});

describe('discover (crt.sh)', () => {
  it('builds the crt.sh query url', () => {
    expect(crtShUrl('lovable.app')).toBe('https://crt.sh/?q=%25.lovable.app&output=json');
  });

  it('parses entries: dedupes, drops wildcards, scopes to apex', () => {
    const entries = [
      { name_value: 'a.lovable.app\n*.lovable.app' },
      { name_value: 'a.lovable.app' }, // dup
      { name_value: 'b.lovable.app' },
      { common_name: 'c.lovable.app' },
      { name_value: 'evil.example.com' }, // out of scope
      { name_value: 'not_a_host' }, // junk
    ];
    expect(parseCrtSh(entries, 'lovable.app')).toEqual([
      'a.lovable.app',
      'b.lovable.app',
      'c.lovable.app',
    ]);
  });

  it('builds the hackertarget url, with and without a key', () => {
    expect(hackerTargetUrl('lovable.app')).toContain('hostsearch/?q=lovable.app');
    expect(hackerTargetUrl('lovable.app', 'K')).toContain('apikey=K');
  });

  it('parses hackertarget CSV: takes host, scopes, drops rate-limit lines', () => {
    const csv = [
      'foo.lovable.app,185.41.148.1',
      'bar.lovable.app,185.41.148.2',
      'foo.lovable.app,185.41.148.1', // dup
      'evil.example.com,1.2.3.4', // out of scope
      'API count exceeded - Increase Quota with Membership', // junk line
    ].join('\n');
    expect(parseHackerTarget(csv, 'lovable.app')).toEqual(['bar.lovable.app', 'foo.lovable.app']);
  });

  it('parses wayback CDX array-of-arrays: dedups hosts, drops header/apex/wildcard', () => {
    const rows = [
      ['original'], // header
      ['https://foo.lovable.app/'],
      ['https://foo.lovable.app/about'], // same host
      ['http://bar.lovable.app/x?y=1'],
      ['https://lovable.app/'], // apex only
      ['https://*.lovable.app/'], // wildcard
      ['https://evil.example.com/'], // out of scope
    ];
    expect(parseWaybackCdx(rows, 'lovable.app')).toEqual(['bar.lovable.app', 'foo.lovable.app']);
    expect(waybackCdxUrl('lovable.app', 100)).toMatch(/web\.archive\.org\/cdx.*limit=100/);
  });

  it('scrapes rapiddns html for in-scope hosts', () => {
    const html = '<td>app-one.lovable.app</td><td>x</td><td>two.lovable.app</td> lovable.app other.example.com';
    expect(parseRapidDns(html, 'lovable.app')).toEqual(['app-one.lovable.app', 'two.lovable.app']);
    expect(rapidDnsUrl('lovable.app')).toBe('https://rapiddns.io/subdomain/lovable.app?full=1');
  });
});

describe('distributed queue', () => {
  const mk = () => createQueue(
    [{ url: 'https://a', slug: 'a' }, { url: 'https://b', slug: 'b' }],
    { leaseMs: 1000, maxAttempts: 2 },
  );

  it('hands each pending target to exactly one claimant', () => {
    const q = mk();
    const t1 = claim(q, 'w1', 1000);
    const t2 = claim(q, 'w2', 1000);
    const t3 = claim(q, 'w3', 1000);
    expect([t1.slug, t2.slug].sort()).toEqual(['a', 'b']); // both claimed, distinct
    expect(t1.slug).not.toBe(t2.slug); // no double-claim
    expect(t3).toBeNull(); // nothing left
  });

  it('completing a target removes it from the queue', () => {
    const q = mk();
    claim(q, 'w1', 1000);
    complete(q, 'a', { status: 'done', findings: 3 });
    const s = stats(q);
    expect(s.done).toBe(1);
    expect(s.findings).toBe(3);
  });

  it('re-queues an expired lease (crash recovery), then fails past maxAttempts', () => {
    const q = mk();
    const t = claim(q, 'w1', 1000); // attempt 1, lease until 2000
    expect(reap(q, 2001)).toBe(1); // expired -> pending
    const again = claim(q, 'w2', 3000); // attempt 2, same target re-handed
    expect(again.slug).toBe(t.slug);
    reap(q, 99999); // attempt 2 expired, at maxAttempts -> failed
    expect(stats(q).failed).toBe(1);
  });

  it('preset marks a slug settled (denylist/resume)', () => {
    const q = mk();
    preset(q, 'a', 'skipped');
    expect(claim(q, 'w1', 1000).slug).toBe('b'); // 'a' skipped, only 'b' claimable
    expect(stats(q).skipped).toBe(1);
  });
});
