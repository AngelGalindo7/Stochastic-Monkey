import { describe, it, expect } from 'vitest';
import { checkCookieSecurity } from '../../src/agent/oracles/cookieSecurity.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePage(cookies, { contextThrows = false } = {}) {
  const cookiesFn = async () => cookies;
  return {
    context: contextThrows
      ? () => { throw new Error('not a context API'); }
      : () => ({ cookies: cookiesFn }),
    cookies: cookiesFn,
  };
}

function goodCookie(overrides = {}) {
  return { name: 'pref', httpOnly: true, secure: true, sameSite: 'Strict', ...overrides };
}

// ---------------------------------------------------------------------------
// Happy path — all flags set correctly
// ---------------------------------------------------------------------------

describe('checkCookieSecurity — silent', () => {
  it('returns null when all cookies are well-formed', async () => {
    const page = makePage([goodCookie()]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBeNull();
  });

  it('returns null when cookies array is empty', async () => {
    const page = makePage([]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBeNull();
  });

  it('returns null when cookies is null/undefined (no cookie jar)', async () => {
    const page = makePage(null);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBeNull();
  });

  it('skips Secure check on localhost HTTP (dev server noise)', async () => {
    const page = makePage([goodCookie({ secure: false })]);
    const result = await checkCookieSecurity(page, 'http://localhost:5173');
    expect(result.signal).toBeNull();
  });

  it('skips Secure check on 127.0.0.1', async () => {
    const page = makePage([goodCookie({ secure: false })]);
    const result = await checkCookieSecurity(page, 'http://127.0.0.1:3000');
    expect(result.signal).toBeNull();
  });


});

// ---------------------------------------------------------------------------
// Fires INSECURE_COOKIES
// ---------------------------------------------------------------------------

describe('checkCookieSecurity — fires', () => {
  it('fires when httpOnly is missing', async () => {
    const page = makePage([goodCookie({ name: 'pref', httpOnly: false })]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBe('INSECURE_COOKIES');
    expect(result.detail).toMatch(/missing HttpOnly/);
  });

  it('fires when Secure is missing on non-localhost', async () => {
    const page = makePage([goodCookie({ name: 'pref', secure: false })]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBe('INSECURE_COOKIES');
    expect(result.detail).toMatch(/missing Secure/);
  });

  it('fires when SameSite is None', async () => {
    const page = makePage([goodCookie({ name: 'pref', sameSite: 'None' })]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBe('INSECURE_COOKIES');
    expect(result.detail).toMatch(/SameSite=None or unset/);
  });

  it('fires when SameSite is absent (null)', async () => {
    const page = makePage([goodCookie({ name: 'pref', sameSite: null })]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBe('INSECURE_COOKIES');
    expect(result.detail).toMatch(/SameSite=None or unset/);
  });

  it('fires when SameSite is undefined', async () => {
    const cookie = goodCookie({ name: 'pref' });
    delete cookie.sameSite;
    const page = makePage([cookie]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBe('INSECURE_COOKIES');
    expect(result.detail).toMatch(/SameSite=None or unset/);
  });

  it('lists all three missing flags together', async () => {
    const page = makePage([{ name: 'pref', httpOnly: false, secure: false, sameSite: null }]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBe('INSECURE_COOKIES');
    expect(result.detail).toMatch(/missing HttpOnly/);
    expect(result.detail).toMatch(/missing Secure/);
    expect(result.detail).toMatch(/SameSite=None or unset/);
  });
});

// ---------------------------------------------------------------------------
// Priority classification — HIGH for session-named cookies
// ---------------------------------------------------------------------------

describe('checkCookieSecurity — priority', () => {
  const sessionNames = ['access_token', 'auth_cookie', 'jwt', 'sb-auth-token', 'supabase', 'session_id', 'refresh', 'credential'];

  it.each(sessionNames)('marks %s as HIGH priority', async (name) => {
    const page = makePage([goodCookie({ name, httpOnly: false })]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.detail).toMatch(new RegExp(`${name} \\[HIGH\\]`));
  });

  it('marks a non-session cookie as LOW priority', async () => {
    const page = makePage([goodCookie({ name: 'theme', httpOnly: false })]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.detail).toMatch(/theme \[LOW\]/);
  });

  it('detail contains issue entries separated by " | "', async () => {
    const page = makePage([
      goodCookie({ name: 'theme', httpOnly: false }),
      goodCookie({ name: 'auth', httpOnly: false }),
    ]);
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.detail).toMatch(/theme \[LOW\].*missing HttpOnly \| auth \[HIGH\].*missing HttpOnly/);
  });
});

// ---------------------------------------------------------------------------
// API fallback — Puppeteer vs Playwright
// ---------------------------------------------------------------------------

describe('checkCookieSecurity — API fallback', () => {
  it('falls back to page.cookies() when page.context() throws', async () => {
    const page = makePage([goodCookie({ name: 'pref', httpOnly: false })], { contextThrows: true });
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBe('INSECURE_COOKIES');
  });

  it('returns null when both context() and cookies() throw', async () => {
    const page = {
      context: () => { throw new Error('no context'); },
      cookies: async () => { throw new Error('no cookies'); },
    };
    const result = await checkCookieSecurity(page, 'https://example.com');
    expect(result.signal).toBeNull();
  });

  it('returns null on entirely broken page object', async () => {
    const result = await checkCookieSecurity({}, 'https://example.com');
    expect(result.signal).toBeNull();
  });
});
