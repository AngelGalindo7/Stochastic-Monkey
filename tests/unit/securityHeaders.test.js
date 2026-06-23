import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkSecurityHeaders } from '../../src/agent/oracles/securityHeaders.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_HEADERS = {
  'content-security-policy':   "default-src 'self'",
  'x-frame-options':           'DENY',
  'x-content-type-options':    'nosniff',
  'strict-transport-security': 'max-age=31536000',
};

function makeResponse(present) {
  const map = Object.fromEntries(present.map((k) => [k, 'set']));
  return { headers: { get: (name) => map[name] ?? null } };
}

function stubFetch(response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// Silent — all headers present
// ---------------------------------------------------------------------------

describe('checkSecurityHeaders — silent', () => {
  it('returns null when all four headers are present', async () => {
    stubFetch(makeResponse(Object.keys(ALL_HEADERS)));
    const r = await checkSecurityHeaders('https://example.com');
    expect(r.signal).toBeNull();
  });

  it('skips HSTS check on localhost (http)', async () => {
    stubFetch(makeResponse(['content-security-policy', 'x-frame-options', 'x-content-type-options']));
    const r = await checkSecurityHeaders('http://localhost:3000');
    expect(r.signal).toBeNull();
  });

  it('skips HSTS check on 127.0.0.1', async () => {
    stubFetch(makeResponse(['content-security-policy', 'x-frame-options', 'x-content-type-options']));
    const r = await checkSecurityHeaders('http://127.0.0.1:8080');
    expect(r.signal).toBeNull();
  });

  it('returns null when fetch throws (network error — no false positive)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED')));
    const r = await checkSecurityHeaders('https://example.com');
    expect(r.signal).toBeNull();
  });

  it('returns null on a malformed URL (fetch will throw)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const r = await checkSecurityHeaders('not-a-url');
    expect(r.signal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fires MISSING_SECURITY_HEADERS
// ---------------------------------------------------------------------------

describe('checkSecurityHeaders — fires', () => {
  it('fires when Content-Security-Policy is absent', async () => {
    stubFetch(makeResponse(['x-frame-options', 'x-content-type-options', 'strict-transport-security']));
    const r = await checkSecurityHeaders('https://example.com');
    expect(r.signal).toBe('MISSING_SECURITY_HEADERS');
    expect(r.detail).toMatch(/Content-Security-Policy/);
  });

  it('fires when X-Frame-Options is absent', async () => {
    stubFetch(makeResponse(['content-security-policy', 'x-content-type-options', 'strict-transport-security']));
    const r = await checkSecurityHeaders('https://example.com');
    expect(r.signal).toBe('MISSING_SECURITY_HEADERS');
    expect(r.detail).toMatch(/X-Frame-Options/);
  });

  it('fires when X-Content-Type-Options is absent', async () => {
    stubFetch(makeResponse(['content-security-policy', 'x-frame-options', 'strict-transport-security']));
    const r = await checkSecurityHeaders('https://example.com');
    expect(r.signal).toBe('MISSING_SECURITY_HEADERS');
    expect(r.detail).toMatch(/X-Content-Type-Options/);
  });

  it('fires when HSTS is absent on non-localhost', async () => {
    stubFetch(makeResponse(['content-security-policy', 'x-frame-options', 'x-content-type-options']));
    const r = await checkSecurityHeaders('https://example.com');
    expect(r.signal).toBe('MISSING_SECURITY_HEADERS');
    expect(r.detail).toMatch(/Strict-Transport-Security/);
  });

  it('fires when HSTS is absent on an HTTPS non-localhost URL', async () => {
    stubFetch(makeResponse(['content-security-policy', 'x-frame-options', 'x-content-type-options']));
    const r = await checkSecurityHeaders('https://staging.example.com');
    expect(r.signal).toBe('MISSING_SECURITY_HEADERS');
    expect(r.detail).toMatch(/Strict-Transport-Security/);
  });

  it('lists all missing headers when none are present', async () => {
    stubFetch(makeResponse([]));
    const r = await checkSecurityHeaders('https://example.com');
    expect(r.signal).toBe('MISSING_SECURITY_HEADERS');
    expect(r.detail).toMatch(/Content-Security-Policy/);
    expect(r.detail).toMatch(/X-Frame-Options/);
    expect(r.detail).toMatch(/X-Content-Type-Options/);
    expect(r.detail).toMatch(/Strict-Transport-Security/);
  });

  it('lists only HSTS when the other three are present on non-localhost', async () => {
    stubFetch(makeResponse(['content-security-policy', 'x-frame-options', 'x-content-type-options']));
    const r = await checkSecurityHeaders('https://example.com');
    expect(r.signal).toBe('MISSING_SECURITY_HEADERS');
    expect(r.detail).not.toMatch(/Content-Security-Policy/);
    expect(r.detail).not.toMatch(/X-Frame-Options/);
    expect(r.detail).toMatch(/Strict-Transport-Security/);
  });
});

// ---------------------------------------------------------------------------
// fetch call shape
// ---------------------------------------------------------------------------

describe('checkSecurityHeaders — fetch call', () => {
  it('calls fetch with method GET and redirect follow', async () => {
    stubFetch(makeResponse(Object.keys(ALL_HEADERS)));
    const url = 'https://example.com';
    await checkSecurityHeaders(url);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(url, expect.objectContaining({
      method: 'GET',
      redirect: 'follow',
    }));
  });
});
