import { describe, it, expect, vi } from 'vitest';
import { checkIdempotency } from '../../src/agent/oracles/idempotency.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(responses) {
  const fetch = vi.fn();
  for (const r of responses) fetch.mockResolvedValueOnce(r);
  return { fetch };
}

function makeCapture(overrides = {}) {
  return {
    method: 'POST',
    url: 'http://localhost:8000/api/orders',
    status: 201,
    resourceType: 'fetch',
    resource_id: null,
    requestBody: { item: 'widget' },
    responseBody: { id: 1 },
    requestHeaders: { 'idempotency-key': 'key-abc', authorization: 'Bearer tok' },
    ...overrides,
  };
}

const DEFAULTS = {
  allowedDomains: ['localhost'],
  config: {},
};

// ---------------------------------------------------------------------------
// Core violation detection
// ---------------------------------------------------------------------------

describe('checkIdempotency — IDEMPOTENCY_VIOLATION', () => {
  it('fires when original id ≠ replay id (classic double-write)', async () => {
    const client = makeClient([{ status: 201, body: { id: 2 } }]);
    const result = await checkIdempotency({
      captures: [makeCapture()],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBe('IDEMPOTENCY_VIOLATION');
    expect(result.detail).toMatch(/original id=1.*replay.*id=2/);
    expect(result.detail).toMatch(/idempotency-key not honored/);
  });

  it('is silent when original id = replay id (server honored the key)', async () => {
    const client = makeClient([{ status: 201, body: { id: 1 } }]);
    const result = await checkIdempotency({
      captures: [makeCapture()],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
  });

  it('fires on x-idempotency-key variant', async () => {
    const cap = makeCapture({ requestHeaders: { 'x-idempotency-key': 'key-xyz', authorization: 'Bearer tok' } });
    const client = makeClient([{ status: 201, body: { id: 99 } }]);
    const result = await checkIdempotency({
      captures: [cap],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBe('IDEMPOTENCY_VIOLATION');
    expect(result.detail).toMatch(/x-idempotency-key/);
  });

  it('fires on PUT with idempotency key', async () => {
    const cap = makeCapture({
      method: 'PUT',
      url: 'http://localhost:8000/api/orders/1',
      status: 200,
      responseBody: { id: 1 },
    });
    const client = makeClient([{ status: 200, body: { id: 2 } }]);
    const result = await checkIdempotency({
      captures: [cap],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBe('IDEMPOTENCY_VIOLATION');
  });

  it('forwards auth + idempotency headers on replay', async () => {
    const client = makeClient([{ status: 201, body: { id: 2 } }]);
    await checkIdempotency({
      captures: [makeCapture()],
      client,
      ...DEFAULTS,
    });
    const [, fetchOpts] = client.fetch.mock.calls[0];
    expect(fetchOpts.headers['idempotency-key']).toBe('key-abc');
    expect(fetchOpts.headers['authorization']).toBe('Bearer tok');
  });
});

// ---------------------------------------------------------------------------
// Silent paths — no idempotency key
// ---------------------------------------------------------------------------

describe('checkIdempotency — silent when no key header', () => {
  it('is silent when requestHeaders has no idempotency key', async () => {
    const cap = makeCapture({ requestHeaders: { authorization: 'Bearer tok' } });
    const client = makeClient([]);
    const result = await checkIdempotency({ captures: [cap], client, ...DEFAULTS });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('is silent when requestHeaders is null', async () => {
    const cap = makeCapture({ requestHeaders: null });
    const client = makeClient([]);
    const result = await checkIdempotency({ captures: [cap], client, ...DEFAULTS });
    expect(result.signal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Silent paths — response guards
// ---------------------------------------------------------------------------

describe('checkIdempotency — silent on 204 and no-body', () => {
  it('is silent when original status is 204 (no body to extract id from)', async () => {
    const cap = makeCapture({ status: 204, responseBody: null });
    const client = makeClient([]);
    const result = await checkIdempotency({ captures: [cap], client, ...DEFAULTS });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('is silent when original response body has no extractable id', async () => {
    const cap = makeCapture({ responseBody: { message: 'ok' } });
    const client = makeClient([]);
    const result = await checkIdempotency({ captures: [cap], client, ...DEFAULTS });
    expect(result.signal).toBeNull();
  });

  it('is silent when replay response body has no extractable id', async () => {
    const cap = makeCapture();
    const client = makeClient([{ status: 200, body: { message: 'cached' } }]);
    const result = await checkIdempotency({ captures: [cap], client, ...DEFAULTS });
    expect(result.signal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Silent paths — config and domain guards
// ---------------------------------------------------------------------------

describe('checkIdempotency — config guards', () => {
  it('is silent when enabled: false', async () => {
    const client = makeClient([]);
    const result = await checkIdempotency({
      captures: [makeCapture()],
      client,
      allowedDomains: ['localhost'],
      config: { enabled: false },
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('is silent when client is null (Puppeteer fallback arm)', async () => {
    const result = await checkIdempotency({
      captures: [makeCapture()],
      client: null,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
  });

  it('is silent when captures is empty', async () => {
    const client = makeClient([]);
    const result = await checkIdempotency({ captures: [], client, ...DEFAULTS });
    expect(result.signal).toBeNull();
  });

  it('is silent for non-first-party domain', async () => {
    const cap = makeCapture({ url: 'https://third-party.example.com/api/orders' });
    const client = makeClient([]);
    const result = await checkIdempotency({ captures: [cap], client, ...DEFAULTS });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// maxReplaysPerRun cap
// ---------------------------------------------------------------------------

describe('checkIdempotency — maxReplaysPerRun', () => {
  it('fires only once when two qualifying captures exceed maxReplaysPerRun: 1', async () => {
    const cap1 = makeCapture({ url: 'http://localhost:8000/api/orders' });
    const cap2 = makeCapture({ url: 'http://localhost:8000/api/items' });
    // Only one replay response needed — second capture never replayed
    const client = makeClient([{ status: 201, body: { id: 2 } }]);
    const result = await checkIdempotency({
      captures: [cap1, cap2],
      client,
      allowedDomains: ['localhost'],
      config: { maxReplaysPerRun: 1 },
    });
    expect(result.signal).toBe('IDEMPOTENCY_VIOLATION');
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });

  it('respects a shared replayCount across calls (cross-step cap)', async () => {
    const sharedCount = { value: 0 };
    const cap = makeCapture();
    const client1 = makeClient([{ status: 201, body: { id: 2 } }]);
    // First call increments count to 1 → cap is exhausted
    const r1 = await checkIdempotency({
      captures: [cap],
      client: client1,
      allowedDomains: ['localhost'],
      config: { maxReplaysPerRun: 1 },
      replayCount: sharedCount,
    });
    expect(r1.signal).toBe('IDEMPOTENCY_VIOLATION');

    const client2 = makeClient([{ status: 201, body: { id: 3 } }]);
    // Second call: count is already 1, cap is already met → no replay
    const r2 = await checkIdempotency({
      captures: [cap],
      client: client2,
      allowedDomains: ['localhost'],
      config: { maxReplaysPerRun: 1 },
      replayCount: sharedCount,
    });
    expect(r2.signal).toBeNull();
    expect(client2.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Custom keyHeaders config
// ---------------------------------------------------------------------------

describe('checkIdempotency — custom keyHeaders', () => {
  it('fires on a custom header name declared in keyHeaders config', async () => {
    const cap = makeCapture({
      requestHeaders: { 'x-stripe-idempotency': 'idem-42' },
    });
    const client = makeClient([{ status: 201, body: { id: 99 } }]);
    const result = await checkIdempotency({
      captures: [cap],
      client,
      allowedDomains: ['localhost'],
      config: { keyHeaders: ['x-stripe-idempotency'] },
    });
    expect(result.signal).toBe('IDEMPOTENCY_VIOLATION');
  });

  it('is silent when keyHeaders config excludes the captured header', async () => {
    const cap = makeCapture(); // has 'idempotency-key'
    const client = makeClient([]);
    const result = await checkIdempotency({
      captures: [cap],
      client,
      allowedDomains: ['localhost'],
      config: { keyHeaders: ['x-custom-only'] }, // built-in names not in this list
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });
});
