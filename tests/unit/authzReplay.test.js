import { describe, it, expect, vi } from 'vitest';
import { checkAuthzReplay } from '../../src/agent/oracles/authzReplay.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReplay(responses) {
  const fetch = vi.fn();
  for (const r of responses) fetch.mockResolvedValueOnce(r);
  return { fetch };
}

// An authenticated GET the user made: carries a bearer token + public apikey, and the
// response body contains the owned record id.
function ownedRead(overrides = {}) {
  return {
    method: 'GET',
    url: 'https://abc.supabase.co/rest/v1/orders?id=eq.42',
    status: 200,
    resourceType: 'fetch',
    responseBody: [{ id: 42, total: 99, owner_id: 7 }],
    requestHeaders: { apikey: 'anon-key', authorization: 'Bearer user-jwt' },
    ...overrides,
  };
}

const DEFAULTS = { allowedDomains: ['supabase.co'], config: { maxReplays: 8 } };

// ---------------------------------------------------------------------------
// The leak case
// ---------------------------------------------------------------------------

describe('checkAuthzReplay — leak detection', () => {
  it('flags AUTHZ_UNCERTAIN when anon replay returns the same owned id', async () => {
    const replay = makeReplay([{ status: 200, body: [{ id: 42, total: 99 }] }]);
    const result = await checkAuthzReplay({ reads: [ownedRead()], replay, ...DEFAULTS });
    expect(result.signal).toBe('AUTHZ_UNCERTAIN');
    expect(result.detail).toMatch(/orders\?id=eq\.42/);
  });

  it('replays with the user bearer stripped but the public apikey kept', async () => {
    const replay = makeReplay([{ status: 200, body: [{ id: 42 }] }]);
    await checkAuthzReplay({ reads: [ownedRead()], replay, ...DEFAULTS });
    expect(replay.fetch).toHaveBeenCalledWith(
      'https://abc.supabase.co/rest/v1/orders?id=eq.42',
      { headers: { apikey: 'anon-key' } },
    );
  });

  it('matches an owned id nested in a wrapper object', async () => {
    const replay = makeReplay([{ status: 200, body: { data: { id: 42 } } }]);
    const result = await checkAuthzReplay({
      reads: [ownedRead({ responseBody: { data: { id: 42, secret: 'x' } } })],
      replay,
      ...DEFAULTS,
    });
    expect(result.signal).toBe('AUTHZ_UNCERTAIN');
  });
});

// ---------------------------------------------------------------------------
// Correctly enforced — must stay silent (no hallucination)
// ---------------------------------------------------------------------------

describe('checkAuthzReplay — enforcement (silent)', () => {
  it('is silent when anon replay is rejected (401)', async () => {
    const replay = makeReplay([{ status: 401, body: { message: 'JWT required' } }]);
    const result = await checkAuthzReplay({ reads: [ownedRead()], replay, ...DEFAULTS });
    expect(result.signal).toBeNull();
  });

  it('is silent when anon replay is forbidden (403)', async () => {
    const replay = makeReplay([{ status: 403, body: null }]);
    const result = await checkAuthzReplay({ reads: [ownedRead()], replay, ...DEFAULTS });
    expect(result.signal).toBeNull();
  });

  it('is silent when RLS filters the row to an empty array (200 + [])', async () => {
    const replay = makeReplay([{ status: 200, body: [] }]);
    const result = await checkAuthzReplay({ reads: [ownedRead()], replay, ...DEFAULTS });
    expect(result.signal).toBeNull();
  });

  it('is silent when anon gets a 200 but a DIFFERENT record (no id overlap)', async () => {
    const replay = makeReplay([{ status: 200, body: [{ id: 999 }] }]);
    const result = await checkAuthzReplay({ reads: [ownedRead()], replay, ...DEFAULTS });
    expect(result.signal).toBeNull();
  });

  it('is silent when the replay client throws (network error — no guess)', async () => {
    const replay = { fetch: vi.fn().mockRejectedValue(new Error('net::ERR_FAILED')) };
    const result = await checkAuthzReplay({ reads: [ownedRead()], replay, ...DEFAULTS });
    expect(result.signal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Conservative guards — candidates we must not even replay
// ---------------------------------------------------------------------------

describe('checkAuthzReplay — guards (never replayed)', () => {
  it('skips reads that carried no user bearer (cookie-auth / already public)', async () => {
    const replay = makeReplay([]);
    const result = await checkAuthzReplay({
      reads: [ownedRead({ requestHeaders: { apikey: 'anon-key' } })],
      replay,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
    expect(replay.fetch).not.toHaveBeenCalled();
  });

  it('skips capability / signed URLs (auth is in the URL)', async () => {
    const replay = makeReplay([]);
    const result = await checkAuthzReplay({
      reads: [ownedRead({ url: 'https://abc.supabase.co/storage/v1/object/sign/x?token=abc.def.ghi' })],
      replay,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
    expect(replay.fetch).not.toHaveBeenCalled();
  });

  it('skips URLs on the public allowlist', async () => {
    const replay = makeReplay([]);
    const result = await checkAuthzReplay({
      reads: [ownedRead({ url: 'https://abc.supabase.co/rest/v1/public_posts?id=eq.42' })],
      replay,
      allowedDomains: ['supabase.co'],
      config: { publicAllowlist: ['/public_'] },
    });
    expect(result.signal).toBeNull();
    expect(replay.fetch).not.toHaveBeenCalled();
  });

  it('skips reads whose body has no extractable id', async () => {
    const replay = makeReplay([]);
    const result = await checkAuthzReplay({
      reads: [ownedRead({ responseBody: { count: 3, status: 'ok' } })],
      replay,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
    expect(replay.fetch).not.toHaveBeenCalled();
  });

  it('skips non-GET (mutation) captures', async () => {
    const replay = makeReplay([]);
    const result = await checkAuthzReplay({
      reads: [ownedRead({ method: 'POST' })],
      replay,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
    expect(replay.fetch).not.toHaveBeenCalled();
  });

  it('skips reads that the user did not successfully get (non-2xx)', async () => {
    const replay = makeReplay([]);
    const result = await checkAuthzReplay({
      reads: [ownedRead({ status: 404 })],
      replay,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
    expect(replay.fetch).not.toHaveBeenCalled();
  });

  it('skips third-party domains', async () => {
    const replay = makeReplay([]);
    const result = await checkAuthzReplay({
      reads: [ownedRead({ url: 'https://api.stripe.com/v1/charges/ch_42' })],
      replay,
      allowedDomains: ['supabase.co'],
      config: {},
    });
    expect(result.signal).toBeNull();
    expect(replay.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

describe('checkAuthzReplay — bookkeeping', () => {
  it('dedupes repeated URLs (replays each endpoint once)', async () => {
    const replay = makeReplay([{ status: 401, body: null }]);
    await checkAuthzReplay({ reads: [ownedRead(), ownedRead()], replay, ...DEFAULTS });
    expect(replay.fetch).toHaveBeenCalledTimes(1);
  });

  it('caps the number of replays at maxReplays', async () => {
    const reads = Array.from({ length: 5 }, (_, i) =>
      ownedRead({ url: `https://abc.supabase.co/rest/v1/orders?id=eq.${i}`, responseBody: [{ id: i }] }),
    );
    const replay = { fetch: vi.fn().mockResolvedValue({ status: 401, body: null }) };
    await checkAuthzReplay({ reads, replay, allowedDomains: ['supabase.co'], config: { maxReplays: 2 } });
    expect(replay.fetch).toHaveBeenCalledTimes(2);
  });

  it('reports a leak across several endpoints', async () => {
    const reads = [
      ownedRead({ url: 'https://abc.supabase.co/rest/v1/orders?id=eq.1', responseBody: [{ id: 1 }] }),
      ownedRead({ url: 'https://abc.supabase.co/rest/v1/orders?id=eq.2', responseBody: [{ id: 2 }] }),
    ];
    const replay = makeReplay([
      { status: 200, body: [{ id: 1 }] },
      { status: 200, body: [{ id: 2 }] },
    ]);
    const result = await checkAuthzReplay({ reads, replay, ...DEFAULTS });
    expect(result.signal).toBe('AUTHZ_UNCERTAIN');
    expect(result.detail).toMatch(/2 endpoint/);
  });

  it('is silent when disabled', async () => {
    const replay = makeReplay([{ status: 200, body: [{ id: 42 }] }]);
    const result = await checkAuthzReplay({
      reads: [ownedRead()],
      replay,
      allowedDomains: ['supabase.co'],
      config: { enabled: false },
    });
    expect(result.signal).toBeNull();
    expect(replay.fetch).not.toHaveBeenCalled();
  });

  it('is silent when there are no reads or no client', async () => {
    expect((await checkAuthzReplay({ reads: [], replay: makeReplay([]), ...DEFAULTS })).signal).toBeNull();
    expect((await checkAuthzReplay({ reads: [ownedRead()], replay: null, ...DEFAULTS })).signal).toBeNull();
  });
});
