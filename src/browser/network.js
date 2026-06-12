const BODY_SIZE_LIMIT = 64 * 1024; // 64 KB — guards against OOM on large API responses

// Pure media/style asset types that will never carry JSON bodies.
// Skipping them keeps the captures array lean for downstream oracles (B2, B6).
const SKIP_RESOURCE_TYPES = new Set([
  'image', 'stylesheet', 'font', 'media', 'texttrack', 'eventsource', 'manifest', 'ping',
]);

function isJsonContentType(ct) {
  return typeof ct === 'string' && ct.includes('application/json');
}

function tryParseJson(str) {
  if (!str || typeof str !== 'string') return null;
  try { return JSON.parse(str); } catch { return null; }
}

// Hard-signal event capture — engine-agnostic, unchanged from the original shape.
// pageEventsToHardSignals in httpSignals.js reads this array directly.
export function attachNetworkEvents(page) {
  const events = [];
  page.on('pageerror', (err) =>
    events.push({ type: 'PAGEERROR', message: err.message, stack: err.stack }),
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      events.push({ type: 'CONSOLE_ERROR', message: msg.text(), url: msg.location()?.url ?? '' });
    }
  });
  page.on('requestfailed', (req) =>
    events.push({
      type: 'REQUEST_FAILED',
      url: req.url(),
      reason: req.failure()?.errorText,
    }),
  );
  page.on('response', (res) => {
    const status = res.status();
    if (status < 400) return;
    const resourceType = res.request()?.resourceType?.() ?? 'other';
    const type = status >= 500 ? 'HTTP_5XX' : 'HTTP_4XX';
    events.push({ type, url: res.url(), status, resourceType });
  });
  return events;
}

// Full request/response tuple capture for Playwright pages.
//
// Uses the `requestfinished` event where Playwright has already buffered the response
// body in memory — `response.body()` is safe and fast at this point. Raw CDP
// `Network.getResponseBody` is NOT used here: it is timing/eviction/OOPIF-fragile
// and cannot be relied upon from within a response-event handler.
//
// Guards:
//   - 3xx: response.body() throws on redirects; skip 300–399 entirely.
//   - Content-type: capture JSON bodies only (no OOM from binary assets).
//   - Size: skip bodies larger than bodySizeLimit.
//   - Resource type: skip pure asset types that cannot carry JSON.
//
// Returns the live captures array. Callers slice it per-step the same way they
// slice page.events: `captures.slice(beforeCaptures)` after executing an action.
// Body resolution is async — a small settlement gap exists between requestfinished
// firing and the capture appearing in the array. For step-boundary slicing, this
// is safe in practice because response.body() reads an already-buffered value and
// resolves in the same microtask batch as the action's network idle wait.
export function attachPlaywrightCapture(page, { bodySizeLimit = BODY_SIZE_LIMIT } = {}) {
  const captures = [];

  page.on('requestfinished', async (req) => {
    try {
      if (SKIP_RESOURCE_TYPES.has(req.resourceType())) return;

      const res = await req.response();
      if (!res) return;
      const status = res.status();
      if (status >= 300 && status < 400) return; // body() throws on redirects

      const method = req.method();
      const url = req.url();
      const resourceType = req.resourceType();
      const contentType = res.headers()['content-type'] ?? '';

      let requestBody = null;
      try {
        const raw = req.postData();
        if (raw) requestBody = tryParseJson(raw);
      } catch {}

      let responseBody = null;
      if (isJsonContentType(contentType)) {
        try {
          const buf = await res.body();
          if (buf.length <= bodySizeLimit) responseBody = tryParseJson(buf.toString('utf-8'));
        } catch {}
      }

      captures.push({ method, url, resourceType, status, requestBody, responseBody });
    } catch {} // capture errors must never affect the crawl
  });

  return captures;
}

// Full request/response tuple capture for Puppeteer pages via CDP Network domain.
//
// Playwright's buffered response.body() API is not available in Puppeteer, so we
// use raw CDP instead. The response body fetch is deferred with setImmediate (off-
// handler) as required by the plan — calling Network.getResponseBody synchronously
// inside loadingFinished can race the browser's eviction of the response buffer.
//
// The cdpClient must be a CDPSession from `page.target().createCDPSession()`.
// Returns the live captures array after setting up all CDP listeners.
export async function attachPuppeteerCapture(cdpClient, { bodySizeLimit = BODY_SIZE_LIMIT } = {}) {
  const captures = [];
  const tracker = new Map(); // requestId → accumulated request/response metadata

  await cdpClient.send('Network.enable', { maxPostDataSize: bodySizeLimit });

  cdpClient.on('Network.requestWillBeSent', ({ requestId, request, type }) => {
    tracker.set(requestId, {
      method: request.method,
      url: request.url,
      resourceType: (type ?? 'Other').toLowerCase(),
      postData: request.postData ?? null,
      status: -1,
      contentType: '',
    });
  });

  cdpClient.on('Network.responseReceived', ({ requestId, response }) => {
    const info = tracker.get(requestId);
    if (!info) return;
    info.status = response.status;
    // CDP headers are case-inconsistent across browsers; check both forms.
    info.contentType = response.headers['content-type'] ?? response.headers['Content-Type'] ?? '';
  });

  cdpClient.on('Network.loadingFinished', ({ requestId }) => {
    const info = tracker.get(requestId);
    if (!info) return;
    tracker.delete(requestId);

    if (SKIP_RESOURCE_TYPES.has(info.resourceType)) return;
    if (info.status >= 300 && info.status < 400) return;

    const base = {
      method: info.method,
      url: info.url,
      resourceType: info.resourceType,
      status: info.status,
      requestBody: tryParseJson(info.postData),
    };

    if (!isJsonContentType(info.contentType)) {
      captures.push({ ...base, responseBody: null });
      return;
    }

    // Off-handler: defers the CDP round-trip out of the synchronous event callback.
    // Fallback: if getResponseBody fails (eviction, OOPIF), record the metadata
    // without the body rather than dropping the capture entirely.
    setImmediate(async () => {
      try {
        const { body, base64Encoded } = await cdpClient.send('Network.getResponseBody', { requestId });
        const rawBuf = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf-8');
        captures.push({ ...base, responseBody: rawBuf.length <= bodySizeLimit ? tryParseJson(rawBuf.toString('utf-8')) : null });
      } catch {
        captures.push({ ...base, responseBody: null });
      }
    });
  });

  return captures;
}
