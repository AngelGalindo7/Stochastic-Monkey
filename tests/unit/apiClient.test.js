import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sharedJarClient, isolatedClient } from '../../src/agent/apiClient.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

vi.mock('playwright', () => ({
  request: {
    newContext: vi.fn(),
  },
}));

import { request as playwrightRequest } from 'playwright';

function makeApiResponse({ status = 200, contentType = 'application/json', text = '{"ok":true}' } = {}) {
  return {
    status: () => status,
    headers: () => ({ 'content-type': contentType }),
    text: async () => text,
  };
}

function makeFakeContext(apiResponse) {
  const fetchFn = vi.fn().mockResolvedValue(apiResponse);
  return {
    fetch: fetchFn,
    dispose: vi.fn().mockResolvedValue(undefined),
    _fetchFn: fetchFn,
  };
}

function makePage(apiResponse) {
  const ctx = makeFakeContext(apiResponse);
  return {
    context: () => ({ request: ctx }),
    _ctx: ctx,
  };
}

// ---------------------------------------------------------------------------
// sharedJarClient
// ---------------------------------------------------------------------------

describe('sharedJarClient', () => {
  it('returns { status, body } for a 200 JSON response', async () => {
    const page = makePage(makeApiResponse({ status: 200, contentType: 'application/json', text: '{"id":42}' }));
    const client = sharedJarClient(page);
    const result = await client.fetch('http://app/api/item');
    expect(result).toEqual({ status: 200, body: { id: 42 } });
  });

  it('returns body: null for a non-JSON content-type', async () => {
    const page = makePage(makeApiResponse({ status: 200, contentType: 'text/plain', text: 'hello' }));
    const client = sharedJarClient(page);
    const result = await client.fetch('http://app/api/text');
    expect(result).toEqual({ status: 200, body: null });
  });

  it('returns body: null when JSON.parse fails on malformed JSON', async () => {
    const page = makePage(makeApiResponse({ status: 200, contentType: 'application/json', text: '{not valid json' }));
    const client = sharedJarClient(page);
    const result = await client.fetch('http://app/api/bad');
    expect(result).toEqual({ status: 200, body: null });
  });

  it('passes options.method through to the underlying request', async () => {
    const page = makePage(makeApiResponse());
    const client = sharedJarClient(page);
    await client.fetch('http://app/api/item', { method: 'POST' });
    expect(page._ctx._fetchFn).toHaveBeenCalledWith('http://app/api/item', { method: 'POST' });
  });

  it('passes options.data through for POST bodies', async () => {
    const page = makePage(makeApiResponse({ status: 201, text: '{"created":true}' }));
    const client = sharedJarClient(page);
    await client.fetch('http://app/api/items', { method: 'POST', data: { name: 'Alice' } });
    expect(page._ctx._fetchFn).toHaveBeenCalledWith('http://app/api/items', { method: 'POST', data: { name: 'Alice' } });
  });

  it('propagates errors from the underlying fetch call', async () => {
    const ctx = makeFakeContext(null);
    ctx._fetchFn.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));
    const page = { context: () => ({ request: ctx }) };
    const client = sharedJarClient(page);
    await expect(client.fetch('http://app/api/item')).rejects.toThrow('net::ERR_CONNECTION_REFUSED');
  });

  it('does not expose a close() method', () => {
    const page = makePage(makeApiResponse());
    const client = sharedJarClient(page);
    expect(client.close).toBeUndefined();
  });

  it('returns { status, body } for a non-2xx JSON response', async () => {
    const page = makePage(makeApiResponse({ status: 404, contentType: 'application/json', text: '{"error":"not found"}' }));
    const client = sharedJarClient(page);
    const result = await client.fetch('http://app/api/missing');
    expect(result).toEqual({ status: 404, body: { error: 'not found' } });
  });
});

// ---------------------------------------------------------------------------
// isolatedClient
// ---------------------------------------------------------------------------

describe('isolatedClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns { status, body } for a 200 JSON response', async () => {
    const fakeCtx = makeFakeContext(makeApiResponse({ status: 200, contentType: 'application/json', text: '{"user":"bob"}' }));
    playwrightRequest.newContext.mockResolvedValue(fakeCtx);
    const client = await isolatedClient(null);
    const result = await client.fetch('http://app/api/user');
    expect(result).toEqual({ status: 200, body: { user: 'bob' } });
  });

  it('returns body: null for a non-JSON content-type', async () => {
    const fakeCtx = makeFakeContext(makeApiResponse({ status: 200, contentType: 'text/html', text: '<html/>' }));
    playwrightRequest.newContext.mockResolvedValue(fakeCtx);
    const client = await isolatedClient(null);
    const result = await client.fetch('http://app/page');
    expect(result).toEqual({ status: 200, body: null });
  });

  it('accepts null storageStatePath and calls newContext with empty options', async () => {
    const fakeCtx = makeFakeContext(makeApiResponse());
    playwrightRequest.newContext.mockResolvedValue(fakeCtx);
    await isolatedClient(null);
    expect(playwrightRequest.newContext).toHaveBeenCalledWith({});
  });

  it('accepts undefined storageStatePath and calls newContext with empty options', async () => {
    const fakeCtx = makeFakeContext(makeApiResponse());
    playwrightRequest.newContext.mockResolvedValue(fakeCtx);
    await isolatedClient(undefined);
    expect(playwrightRequest.newContext).toHaveBeenCalledWith({});
  });

  it('accepts a storageStatePath string and passes it to newContext', async () => {
    const fakeCtx = makeFakeContext(makeApiResponse());
    playwrightRequest.newContext.mockResolvedValue(fakeCtx);
    await isolatedClient('/tmp/state.json');
    expect(playwrightRequest.newContext).toHaveBeenCalledWith({ storageState: '/tmp/state.json' });
  });

  it('close() calls dispose() on the underlying context', async () => {
    const fakeCtx = makeFakeContext(makeApiResponse());
    playwrightRequest.newContext.mockResolvedValue(fakeCtx);
    const client = await isolatedClient(null);
    await client.close();
    expect(fakeCtx.dispose).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from fetch', async () => {
    const fakeCtx = makeFakeContext(null);
    fakeCtx._fetchFn.mockRejectedValue(new Error('net::ERR_FAILED'));
    playwrightRequest.newContext.mockResolvedValue(fakeCtx);
    const client = await isolatedClient(null);
    await expect(client.fetch('http://app/api/item')).rejects.toThrow('net::ERR_FAILED');
  });

  it('propagates errors when newContext rejects', async () => {
    playwrightRequest.newContext.mockRejectedValue(new Error('invalid state'));
    await expect(isolatedClient('/bad/path')).rejects.toThrow('invalid state');
  });

  it('returns body: null when JSON.parse fails on malformed JSON', async () => {
    const fakeCtx = makeFakeContext(makeApiResponse({ contentType: 'application/json', text: '{bad json' }));
    playwrightRequest.newContext.mockResolvedValue(fakeCtx);
    const client = await isolatedClient(null);
    const result = await client.fetch('http://app/api/bad');
    expect(result).toEqual({ status: 200, body: null });
  });

  it('returns { status, body } for a non-2xx JSON response', async () => {
    const fakeCtx = makeFakeContext(makeApiResponse({ status: 500, contentType: 'application/json', text: '{"error":"server error"}' }));
    playwrightRequest.newContext.mockResolvedValue(fakeCtx);
    const client = await isolatedClient(null);
    const result = await client.fetch('http://app/api/boom');
    expect(result).toEqual({ status: 500, body: { error: 'server error' } });
  });

  it('each call creates a new independent context', async () => {
    const fakeCtx1 = makeFakeContext(makeApiResponse({ text: '{"n":1}' }));
    const fakeCtx2 = makeFakeContext(makeApiResponse({ text: '{"n":2}' }));
    playwrightRequest.newContext
      .mockResolvedValueOnce(fakeCtx1)
      .mockResolvedValueOnce(fakeCtx2);

    const client1 = await isolatedClient(null);
    const client2 = await isolatedClient(null);

    const result1 = await client1.fetch('http://app/api/a');
    const result2 = await client2.fetch('http://app/api/b');

    expect(result1).toEqual({ status: 200, body: { n: 1 } });
    expect(result2).toEqual({ status: 200, body: { n: 2 } });
    expect(fakeCtx1._fetchFn).toHaveBeenCalledTimes(1);
    expect(fakeCtx2._fetchFn).toHaveBeenCalledTimes(1);
    expect(playwrightRequest.newContext).toHaveBeenCalledTimes(2);
  });
});
