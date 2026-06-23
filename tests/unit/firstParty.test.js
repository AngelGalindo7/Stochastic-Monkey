import { describe, it, expect } from 'vitest';
import { isFirstPartyUrl } from '../../src/perception/firstParty.js';

// ---------------------------------------------------------------------------
// Branch 1: allowedDomains non-empty — hostname-suffix match
// ---------------------------------------------------------------------------

describe('isFirstPartyUrl — allowedDomains list', () => {
  it('accepts an exact hostname match', () => {
    expect(isFirstPartyUrl('https://example.com/path', { allowedDomains: ['example.com'] })).toBe(true);
  });

  it('accepts a subdomain via suffix match', () => {
    expect(isFirstPartyUrl('https://api.example.com/v1', { allowedDomains: ['example.com'] })).toBe(true);
  });

  it('accepts a sibling host on a different port (port is not part of hostname)', () => {
    expect(isFirstPartyUrl('http://localhost:8000/api', { allowedDomains: ['localhost'] })).toBe(true);
  });

  it('accepts a Supabase sibling domain', () => {
    expect(isFirstPartyUrl('https://abc.supabase.co/rest/v1/items', { allowedDomains: ['supabase.co'] })).toBe(true);
  });

  it('rejects a different apex domain', () => {
    expect(isFirstPartyUrl('https://evil.com/path', { allowedDomains: ['example.com'] })).toBe(false);
  });

  it('rejects a URL where the domain is only a suffix of the hostname (not a subdomain)', () => {
    // "notexample.com" should not match allowedDomain "example.com"
    expect(isFirstPartyUrl('https://notexample.com/', { allowedDomains: ['example.com'] })).toBe(false);
  });

  it('accepts when hostname matches one of multiple allowed domains', () => {
    expect(isFirstPartyUrl('https://cdn.example.com/', {
      allowedDomains: ['other.com', 'example.com'],
    })).toBe(true);
  });

  it('ignores targetOrigin when allowedDomains is non-empty', () => {
    // targetOrigin is from a different origin, but the URL IS in allowedDomains
    expect(isFirstPartyUrl('https://api.example.com/', {
      targetOrigin: 'https://ui.example.com',
      allowedDomains: ['example.com'],
    })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Branch 2: allowedDomains empty + targetOrigin — exact origin match
// ---------------------------------------------------------------------------

describe('isFirstPartyUrl — targetOrigin fallback', () => {
  it('accepts when origin matches targetOrigin exactly', () => {
    expect(isFirstPartyUrl('https://example.com/path', {
      targetOrigin: 'https://example.com',
      allowedDomains: [],
    })).toBe(true);
  });

  it('rejects when origin differs from targetOrigin', () => {
    expect(isFirstPartyUrl('https://other.com/path', {
      targetOrigin: 'https://example.com',
      allowedDomains: [],
    })).toBe(false);
  });

  it('rejects a subdomain when using origin-only match (no allowedDomains)', () => {
    expect(isFirstPartyUrl('https://api.example.com/v1', {
      targetOrigin: 'https://example.com',
      allowedDomains: [],
    })).toBe(false);
  });

  it('rejects when port differs under origin match', () => {
    expect(isFirstPartyUrl('http://localhost:8000/api', {
      targetOrigin: 'http://localhost:5173',
      allowedDomains: [],
    })).toBe(false);
  });

  it('accepts when port matches under origin match', () => {
    expect(isFirstPartyUrl('http://localhost:5173/page', {
      targetOrigin: 'http://localhost:5173',
      allowedDomains: [],
    })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Branch 3: allowedDomains empty + no targetOrigin — allow-all
// ---------------------------------------------------------------------------

describe('isFirstPartyUrl — allow-all', () => {
  it('returns true for any URL when both list and origin are absent', () => {
    expect(isFirstPartyUrl('https://anything.example.com/path')).toBe(true);
  });

  it('returns true for third-party URLs when list is empty and no targetOrigin', () => {
    expect(isFirstPartyUrl('https://cdn.jquery.com/jquery.min.js', {})).toBe(true);
  });

  it('returns true for an empty-string targetOrigin (treated as absent)', () => {
    expect(isFirstPartyUrl('https://cdn.other.com/', {
      targetOrigin: '',
      allowedDomains: [],
    })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Malformed / edge-case URLs
// ---------------------------------------------------------------------------

describe('isFirstPartyUrl — malformed URLs', () => {
  it('returns false for a non-URL string with allowedDomains set', () => {
    expect(isFirstPartyUrl('not-a-url', { allowedDomains: ['example.com'] })).toBe(false);
  });

  it('returns false for a non-URL string with targetOrigin set', () => {
    expect(isFirstPartyUrl('not-a-url', { targetOrigin: 'https://example.com', allowedDomains: [] })).toBe(false);
  });

  it('returns true for a malformed URL when allow-all (both absent)', () => {
    // No list, no origin → allow-all path returns true before URL parsing
    expect(isFirstPartyUrl('not-a-url')).toBe(true);
  });

  it('returns false for an empty string URL with allowedDomains set', () => {
    expect(isFirstPartyUrl('', { allowedDomains: ['example.com'] })).toBe(false);
  });
});
