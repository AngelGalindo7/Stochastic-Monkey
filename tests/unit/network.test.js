import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { attachNetworkEvents, attachPlaywrightCapture, attachPuppeteerCapture } from '../../src/browser/network.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makePage() {
  const em = new EventEmitter();
  return { on: (ev, fn) => em.on(ev, fn), _emit: (ev, ...args) => em.emit(ev, ...args) };
}

function makeReq({ method = 'GET', url = 'http://app/api/items', resourceType = 'fetch', postData = null, response = null } = {}) {
  return {
    method: () => method,
    url: () => url,
    resourceType: () => resourceType,
    postData: () => postData,
    response: async () => response,
  };
}

function makeRes({ status = 200, headers = {}, bodyStr = null } = {}) {
  return {
    status: () => status,
    headers: () => headers,
    body: async () => (bodyStr ? Buffer.from(bodyStr) : Buffer.alloc(0)),
  };
}

function makeCdpClient() {
  const em = new EventEmitter();
  const client = {
    on: (ev, fn) => em.on(ev, fn),
    _emit: (ev, ...args) => em.emit(ev, ...args),
    send: vi.fn(),
  };
  return client;
}

const flush = () => new Promise((r) => setImmediate(r));

// ---------------------------------------------------------------------------
// attachNetworkEvents — backward compat
// ---------------------------------------------------------------------------

describe('attachNetworkEvents', () => {
  it('pushes HTTP_5XX for 5xx responses', () => {
    const page = makePage();
    const events = attachNetworkEvents(page);
    const res = { status: () => 500, url: () => 'http://app/api/fail', request: () => ({ resourceType: () => 'fetch' }) };
    page._emit('response', res);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'HTTP_5XX', status: 500 });
  });

  it('pushes HTTP_4XX for 4xx responses', () => {
    const page = makePage();
    const events = attachNetworkEvents(page);
    const res = { status: () => 404, url: () => 'http://app/missing', request: () => ({ resourceType: () => 'document' }) };
    page._emit('response', res);
    expect(events[0]).toMatchObject({ type: 'HTTP_4XX', status: 404 });
  });

  it('ignores responses with status < 400', () => {
    const page = makePage();
    const events = attachNetworkEvents(page);
    const res = { status: () => 200, url: () => 'http://app/api/ok', request: () => ({ resourceType: () => 'fetch' }) };
    page._emit('response', res);
    expect(events).toHaveLength(0);
  });

  it('pushes PAGEERROR', () => {
    const page = makePage();
    const events = attachNetworkEvents(page);
    page._emit('pageerror', { message: 'x is undefined', stack: 'Error: x is undefined\n  at ...' });
    expect(events[0]).toMatchObject({ type: 'PAGEERROR', message: 'x is undefined' });
  });

  it('pushes CONSOLE_ERROR for console error messages', () => {
    const page = makePage();
    const events = attachNetworkEvents(page);
    page._emit('console', { type: () => 'error', text: () => 'Uncaught TypeError' });
    expect(events[0]).toMatchObject({ type: 'CONSOLE_ERROR', message: 'Uncaught TypeError' });
  });

  it('ignores non-error console messages', () => {
    const page = makePage();
    const events = attachNetworkEvents(page);
    page._emit('console', { type: () => 'log', text: () => 'hello' });
    expect(events).toHaveLength(0);
  });

  it('pushes REQUEST_FAILED', () => {
    const page = makePage();
    const events = attachNetworkEvents(page);
    page._emit('requestfailed', { url: () => 'http://app/api/data', failure: () => ({ errorText: 'net::ERR_ABORTED' }) });
    expect(events[0]).toMatchObject({ type: 'REQUEST_FAILED', url: 'http://app/api/data', reason: 'net::ERR_ABORTED' });
  });
});

// ---------------------------------------------------------------------------
// attachPlaywrightCapture
// ---------------------------------------------------------------------------

describe('attachPlaywrightCapture', () => {
  it('captures a successful 200 JSON response', async () => {
    const page = makePage();
    const captures = attachPlaywrightCapture(page);
    const res = makeRes({ status: 200, headers: { 'content-type': 'application/json' }, bodyStr: '{"id":1}' });
    const req = makeReq({ response: res });
    page._emit('requestfinished', req);
    await flush();
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ method: 'GET', url: 'http://app/api/items', status: 200, responseBody: { id: 1 } });
  });

  it('captures and parses a POST request body', async () => {
    const page = makePage();
    const captures = attachPlaywrightCapture(page);
    const res = makeRes({ status: 201, headers: { 'content-type': 'application/json' }, bodyStr: '{"created":true}' });
    const req = makeReq({ method: 'POST', postData: '{"name":"Alice"}', response: res });
    page._emit('requestfinished', req);
    await flush();
    expect(captures[0].requestBody).toEqual({ name: 'Alice' });
  });

  it('skips 3xx responses entirely', async () => {
    const page = makePage();
    const captures = attachPlaywrightCapture(page);
    const res = makeRes({ status: 302, headers: {} });
    const req = makeReq({ response: res });
    page._emit('requestfinished', req);
    await flush();
    expect(captures).toHaveLength(0);
  });

  it('records entry but sets responseBody null for non-JSON content-type', async () => {
    const page = makePage();
    const captures = attachPlaywrightCapture(page);
    const res = makeRes({ status: 200, headers: { 'content-type': 'text/plain' }, bodyStr: 'hello' });
    const req = makeReq({ response: res });
    page._emit('requestfinished', req);
    await flush();
    expect(captures).toHaveLength(1);
    expect(captures[0].responseBody).toBeNull();
  });

  it.each(['image', 'stylesheet', 'font'])('skips asset resource type: %s', async (resourceType) => {
    const page = makePage();
    const captures = attachPlaywrightCapture(page);
    const res = makeRes({ status: 200, headers: { 'content-type': 'application/json' }, bodyStr: '{}' });
    const req = makeReq({ resourceType, response: res });
    page._emit('requestfinished', req);
    await flush();
    expect(captures).toHaveLength(0);
  });

  it('enforces 64KB size cap — oversized body produces responseBody: null', async () => {
    const page = makePage();
    const captures = attachPlaywrightCapture(page);
    const big = JSON.stringify({ data: 'x'.repeat(65 * 1024) });
    const res = makeRes({ status: 200, headers: { 'content-type': 'application/json' }, bodyStr: big });
    const req = makeReq({ response: res });
    page._emit('requestfinished', req);
    await flush();
    expect(captures).toHaveLength(1);
    expect(captures[0].responseBody).toBeNull();
  });

  it('captures a 500 response with a JSON body', async () => {
    const page = makePage();
    const captures = attachPlaywrightCapture(page);
    const res = makeRes({ status: 500, headers: { 'content-type': 'application/json' }, bodyStr: '{"error":"oops"}' });
    const req = makeReq({ response: res });
    page._emit('requestfinished', req);
    await flush();
    expect(captures[0]).toMatchObject({ status: 500, responseBody: { error: 'oops' } });
  });

  it('captures a 404 response', async () => {
    const page = makePage();
    const captures = attachPlaywrightCapture(page);
    const res = makeRes({ status: 404, headers: { 'content-type': 'application/json' }, bodyStr: '{"msg":"not found"}' });
    const req = makeReq({ url: 'http://app/api/missing', response: res });
    page._emit('requestfinished', req);
    await flush();
    expect(captures[0]).toMatchObject({ status: 404, url: 'http://app/api/missing' });
  });

  it('sets requestBody null for GET requests with no postData', async () => {
    const page = makePage();
    const captures = attachPlaywrightCapture(page);
    const res = makeRes({ status: 200, headers: { 'content-type': 'application/json' }, bodyStr: '[]' });
    const req = makeReq({ method: 'GET', postData: null, response: res });
    page._emit('requestfinished', req);
    await flush();
    expect(captures[0].requestBody).toBeNull();
  });

  it('handles null response from req.response() without throwing', async () => {
    const page = makePage();
    const captures = attachPlaywrightCapture(page);
    const req = makeReq({ response: null });
    page._emit('requestfinished', req);
    await flush();
    expect(captures).toHaveLength(0);
  });

  it('does not interfere with attachNetworkEvents on the same page', async () => {
    const page = makePage();
    const events = attachNetworkEvents(page);
    const captures = attachPlaywrightCapture(page);

    const res = makeRes({ status: 200, headers: { 'content-type': 'application/json' }, bodyStr: '{"ok":true}' });
    const req = makeReq({ response: res });
    page._emit('requestfinished', req);

    const res5xx = { status: () => 500, url: () => 'http://app/api/boom', request: () => ({ resourceType: () => 'fetch' }) };
    page._emit('response', res5xx);

    await flush();
    expect(captures).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('HTTP_5XX');
  });
});

// ---------------------------------------------------------------------------
// attachPuppeteerCapture
// ---------------------------------------------------------------------------

describe('attachPuppeteerCapture', () => {
  it('calls Network.enable on setup', async () => {
    const cdp = makeCdpClient();
    cdp.send.mockResolvedValue({});
    await attachPuppeteerCapture(cdp);
    expect(cdp.send).toHaveBeenCalledWith('Network.enable', expect.objectContaining({ maxPostDataSize: expect.any(Number) }));
  });

  it('captures a complete JSON request/response cycle', async () => {
    const cdp = makeCdpClient();
    cdp.send.mockResolvedValueOnce({}) // Network.enable
      .mockResolvedValueOnce({ body: JSON.stringify({ items: [] }), base64Encoded: false }); // getResponseBody

    const captures = await attachPuppeteerCapture(cdp);

    cdp._emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { method: 'GET', url: 'http://app/api/items', postData: null },
      type: 'Fetch',
    });
    cdp._emit('Network.responseReceived', {
      requestId: 'r1',
      response: { status: 200, headers: { 'content-type': 'application/json' } },
    });
    cdp._emit('Network.loadingFinished', { requestId: 'r1' });

    await flush();

    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      method: 'GET',
      url: 'http://app/api/items',
      status: 200,
      resourceType: 'fetch',
      responseBody: { items: [] },
    });
  });

  it('skips 3xx in loadingFinished', async () => {
    const cdp = makeCdpClient();
    cdp.send.mockResolvedValue({});
    const captures = await attachPuppeteerCapture(cdp);

    cdp._emit('Network.requestWillBeSent', {
      requestId: 'r2',
      request: { method: 'GET', url: 'http://app/redirect', postData: null },
      type: 'Document',
    });
    cdp._emit('Network.responseReceived', {
      requestId: 'r2',
      response: { status: 301, headers: {} },
    });
    cdp._emit('Network.loadingFinished', { requestId: 'r2' });

    await flush();
    expect(captures).toHaveLength(0);
    expect(cdp.send).not.toHaveBeenCalledWith('Network.getResponseBody', expect.anything());
  });

  it('falls back to responseBody: null when getResponseBody throws', async () => {
    const cdp = makeCdpClient();
    cdp.send.mockResolvedValueOnce({}) // Network.enable
      .mockRejectedValueOnce(new Error('Protocol error: No resource with given identifier found'));

    const captures = await attachPuppeteerCapture(cdp);

    cdp._emit('Network.requestWillBeSent', {
      requestId: 'r3',
      request: { method: 'GET', url: 'http://app/api/data', postData: null },
      type: 'XHR',
    });
    cdp._emit('Network.responseReceived', {
      requestId: 'r3',
      response: { status: 200, headers: { 'content-type': 'application/json' } },
    });
    cdp._emit('Network.loadingFinished', { requestId: 'r3' });

    await flush();
    expect(captures).toHaveLength(1);
    expect(captures[0].responseBody).toBeNull();
  });

  it('sets responseBody null and skips getResponseBody for non-JSON content-type', async () => {
    const cdp = makeCdpClient();
    cdp.send.mockResolvedValueOnce({}); // Network.enable only

    const captures = await attachPuppeteerCapture(cdp);

    cdp._emit('Network.requestWillBeSent', {
      requestId: 'r4',
      request: { method: 'GET', url: 'http://app/page', postData: null },
      type: 'Document',
    });
    cdp._emit('Network.responseReceived', {
      requestId: 'r4',
      response: { status: 200, headers: { 'content-type': 'text/html' } },
    });
    cdp._emit('Network.loadingFinished', { requestId: 'r4' });

    await flush();
    expect(captures).toHaveLength(1);
    expect(captures[0].responseBody).toBeNull();
    expect(cdp.send).toHaveBeenCalledTimes(1); // only Network.enable
  });
});
