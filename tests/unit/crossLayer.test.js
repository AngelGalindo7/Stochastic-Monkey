import { describe, it, expect, vi } from 'vitest';
import { checkCrossLayer } from '../../src/agent/oracles/crossLayer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(responses) {
  const fetch = vi.fn();
  for (const r of responses) fetch.mockResolvedValueOnce(r);
  return { fetch };
}

function okGet()   { return { status: 200, body: { id: 42 } }; }
function gone404() { return { status: 404, body: null }; }
function gone410() { return { status: 410, body: null }; }

function makeCapture(overrides = {}) {
  return {
    method: 'DELETE',
    url: 'http://localhost:8000/api/items/42',
    status: 200,
    resourceType: 'fetch',
    resource_id: { collection: 'items', id: '42' },
    requestBody: null,
    responseBody: null,
    ...overrides,
  };
}

const DEFAULTS = { allowedDomains: ['localhost'], config: { pollAttempts: 1, pollDelayMs: 0 } };

// ---------------------------------------------------------------------------
// DELETE oracle — STATE_NOT_DELETED
// ---------------------------------------------------------------------------

describe('checkCrossLayer — DELETE', () => {
  it('fires STATE_NOT_DELETED when resource still exists after all polls', async () => {
    const client = makeClient([okGet(), okGet(), okGet()]);
    const result = await checkCrossLayer({
      captures: [makeCapture()],
      client,
      allowedDomains: ['localhost'],
      config: { pollAttempts: 3, pollDelayMs: 0 },
    });
    expect(result.signal).toBe('STATE_NOT_DELETED');
    expect(result.detail).toMatch(/GET.*still 200.*3 poll/);
    expect(client.fetch).toHaveBeenCalledTimes(3);
  });

  it('is silent when resource is gone (404)', async () => {
    const client = makeClient([gone404()]);
    const result = await checkCrossLayer({
      captures: [makeCapture()],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
  });

  it('is silent when resource is gone (410 — RFC 9110 permanent removal)', async () => {
    const client = makeClient([gone410()]);
    const result = await checkCrossLayer({
      captures: [makeCapture()],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
  });

  it('is silent when eventually consistent: first 200 then 404 (early exit)', async () => {
    const client = makeClient([okGet(), gone404()]);
    const result = await checkCrossLayer({
      captures: [makeCapture()],
      client,
      allowedDomains: ['localhost'],
      config: { pollAttempts: 3, pollDelayMs: 0 },
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).toHaveBeenCalledTimes(2); // stopped after predicate satisfied
  });

  it('skips the oracle entirely when softDelete=true', async () => {
    const client = makeClient([okGet()]);
    const result = await checkCrossLayer({
      captures: [makeCapture()],
      client,
      allowedDomains: ['localhost'],
      config: { pollAttempts: 1, pollDelayMs: 0, softDelete: true },
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('respects custom goneStatuses including 403', async () => {
    const client = makeClient([{ status: 403, body: null }]);
    const result = await checkCrossLayer({
      captures: [makeCapture()],
      client,
      allowedDomains: ['localhost'],
      config: { pollAttempts: 1, pollDelayMs: 0, goneStatuses: [403, 404, 410] },
    });
    expect(result.signal).toBeNull(); // 403 is in goneStatuses → no bug
  });

  it('fires when status is not in custom goneStatuses', async () => {
    const client = makeClient([{ status: 200, body: { id: 42 } }]);
    const result = await checkCrossLayer({
      captures: [makeCapture()],
      client,
      allowedDomains: ['localhost'],
      config: { pollAttempts: 1, pollDelayMs: 0, goneStatuses: [404] },
    });
    expect(result.signal).toBe('STATE_NOT_DELETED');
  });

  it('strips query string from the verify URL', async () => {
    const client = makeClient([gone404()]);
    await checkCrossLayer({
      captures: [makeCapture({ url: 'http://localhost:8000/api/items/42?cascade=true' })],
      client,
      ...DEFAULTS,
    });
    expect(client.fetch).toHaveBeenCalledWith('http://localhost:8000/api/items/42');
  });

  it('is silent when client.fetch throws (network error — no false positive)', async () => {
    const client = { fetch: vi.fn().mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED')) };
    const result = await checkCrossLayer({
      captures: [makeCapture()],
      client,
      allowedDomains: ['localhost'],
      config: { pollAttempts: 2, pollDelayMs: 0 },
    });
    expect(result.signal).toBeNull();
  });

  it('skips captures with no resource_id in URL', async () => {
    const client = makeClient([]);
    const result = await checkCrossLayer({
      captures: [makeCapture({ resource_id: null })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('skips third-party URLs when allowedDomains is set', async () => {
    const client = makeClient([]);
    const result = await checkCrossLayer({
      captures: [makeCapture({ url: 'https://api.stripe.com/v1/charges/ch_42' })],
      client,
      allowedDomains: ['localhost'],
      config: { pollAttempts: 1, pollDelayMs: 0 },
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('accepts first-party API on a different port from the UI (hostname suffix match)', async () => {
    const client = makeClient([gone404()]);
    const result = await checkCrossLayer({
      captures: [makeCapture({ url: 'http://localhost:8000/api/items/42' })],
      client,
      allowedDomains: ['localhost'],
      config: { pollAttempts: 1, pollDelayMs: 0 },
    });
    // 404 = gone → no bug
    expect(result.signal).toBeNull();
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });

  it('is silent when captures is empty', async () => {
    const client = makeClient([]);
    const result = await checkCrossLayer({ captures: [], client, ...DEFAULTS });
    expect(result.signal).toBeNull();
  });

  it('is silent when enabled=false', async () => {
    const client = makeClient([okGet()]);
    const result = await checkCrossLayer({
      captures: [makeCapture()],
      client,
      allowedDomains: ['localhost'],
      config: { enabled: false, pollAttempts: 1, pollDelayMs: 0 },
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST oracle — STATE_NOT_PERSISTED
// ---------------------------------------------------------------------------

describe('checkCrossLayer — POST', () => {
  it('fires STATE_NOT_PERSISTED when created resource returns 404', async () => {
    const client = makeClient([gone404()]);
    const result = await checkCrossLayer({
      captures: [makeCapture({
        method: 'POST',
        url: 'http://localhost:8000/api/items',
        status: 201,
        resource_id: null,
        responseBody: { id: 99, name: 'Widget' },
      })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBe('STATE_NOT_PERSISTED');
    expect(result.detail).toMatch(/POST.*GET.*items\/99.*404/);
    expect(client.fetch).toHaveBeenCalledWith('http://localhost:8000/api/items/99');
  });

  it('is silent when created resource is readable (201 + GET 200)', async () => {
    const client = makeClient([okGet()]);
    const result = await checkCrossLayer({
      captures: [makeCapture({
        method: 'POST',
        url: 'http://localhost:8000/api/items',
        status: 201,
        resource_id: null,
        responseBody: { id: 42 },
      })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
  });

  it('is silent when eventually consistent: 404 then 200 (early exit)', async () => {
    const client = makeClient([gone404(), okGet()]);
    const result = await checkCrossLayer({
      captures: [makeCapture({
        method: 'POST',
        url: 'http://localhost:8000/api/items',
        status: 201,
        resource_id: null,
        responseBody: { id: 42 },
      })],
      client,
      allowedDomains: ['localhost'],
      config: { pollAttempts: 3, pollDelayMs: 0 },
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).toHaveBeenCalledTimes(2);
  });

  it('skips when POST returns 202 Accepted (async — not committed)', async () => {
    const client = makeClient([]);
    const result = await checkCrossLayer({
      captures: [makeCapture({
        method: 'POST',
        url: 'http://localhost:8000/api/items',
        status: 202,
        resource_id: null,
        responseBody: { job_id: 'abc' },
      })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('skips when POST response body has no extractable id', async () => {
    const client = makeClient([]);
    const result = await checkCrossLayer({
      captures: [makeCapture({
        method: 'POST',
        url: 'http://localhost:8000/api/items',
        status: 201,
        resource_id: null,
        responseBody: { status: 'queued' },
      })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('extracts id from JSON:API single-key data wrapper { data: { id: 5 } }', async () => {
    const client = makeClient([gone404()]);
    await checkCrossLayer({
      captures: [makeCapture({
        method: 'POST',
        url: 'http://localhost:8000/api/items',
        status: 201,
        resource_id: null,
        responseBody: { data: { id: 5, type: 'item' } },
      })],
      client,
      ...DEFAULTS,
    });
    expect(client.fetch).toHaveBeenCalledWith('http://localhost:8000/api/items/5');
  });

  it('uses URL resource_id when POST targets a specific resource (upsert)', async () => {
    const client = makeClient([gone404()]);
    const result = await checkCrossLayer({
      captures: [makeCapture({
        method: 'POST',
        url: 'http://localhost:8000/api/items/42',
        status: 200,
        resource_id: { collection: 'items', id: '42' },
        responseBody: { id: 42 },
      })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBe('STATE_NOT_PERSISTED');
    expect(client.fetch).toHaveBeenCalledWith('http://localhost:8000/api/items/42');
  });
});

// ---------------------------------------------------------------------------
// PUT / PATCH oracle — STATE_NOT_PERSISTED
// ---------------------------------------------------------------------------

describe('checkCrossLayer — PUT / PATCH', () => {
  it('fires STATE_NOT_PERSISTED when PUT resource is gone after update', async () => {
    const client = makeClient([gone404()]);
    const result = await checkCrossLayer({
      captures: [makeCapture({
        method: 'PUT',
        url: 'http://localhost:8000/api/items/42',
        status: 200,
        resource_id: { collection: 'items', id: '42' },
      })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBe('STATE_NOT_PERSISTED');
  });

  it('fires STATE_NOT_PERSISTED when PATCH resource is gone after update', async () => {
    const client = makeClient([gone404()]);
    const result = await checkCrossLayer({
      captures: [makeCapture({
        method: 'PATCH',
        url: 'http://localhost:8000/api/items/42',
        status: 200,
        resource_id: { collection: 'items', id: '42' },
      })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBe('STATE_NOT_PERSISTED');
  });

  it('is silent when PATCH resource is still readable', async () => {
    const client = makeClient([okGet()]);
    const result = await checkCrossLayer({
      captures: [makeCapture({
        method: 'PATCH',
        url: 'http://localhost:8000/api/items/42',
        status: 200,
        resource_id: { collection: 'items', id: '42' },
      })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No mutation / non-mutation captures
// ---------------------------------------------------------------------------

describe('checkCrossLayer — no mutation', () => {
  it('is silent when only GET captures are present', async () => {
    const client = makeClient([]);
    const result = await checkCrossLayer({
      captures: [makeCapture({ method: 'GET', status: 200 })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('is silent when mutation returned 4xx (not committed)', async () => {
    const client = makeClient([]);
    const result = await checkCrossLayer({
      captures: [makeCapture({ status: 422 })],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it('uses the last committed mutation when multiple are present', async () => {
    const client = makeClient([gone404()]);
    const result = await checkCrossLayer({
      captures: [
        makeCapture({ url: 'http://localhost:8000/api/old/1', resource_id: { collection: 'old', id: '1' } }),
        makeCapture({ url: 'http://localhost:8000/api/items/42', resource_id: { collection: 'items', id: '42' } }),
      ],
      client,
      ...DEFAULTS,
    });
    expect(result.signal).toBeNull(); // 404 = gone on the last mutation
    expect(client.fetch).toHaveBeenCalledWith('http://localhost:8000/api/items/42');
  });
});
