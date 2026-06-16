// B2 cross-layer persisted-state oracle.
//
// After a committed mutation (POST/PUT/PATCH/DELETE returning 2xx but NOT 202),
// re-reads the affected resource as the same user and asserts:
//   DELETE → resource is gone (status in goneStatuses)
//   POST / PUT / PATCH → resource exists (status NOT in goneStatuses)
//
// Reliability conditions (all configurable — not constants):
//   pollAttempts  — retry the read N times before flagging; covers the
//                   UI-signal-vs-committed-state race for eventually-consistent
//                   backends. The B12 / RFC 9110 body of evidence makes this
//                   non-negotiable; naive write-then-immediately-read oracles
//                   produce false positives on read replicas.
//   goneStatuses  — configurable "gone" status set. Defaults to [404, 410]
//                   per RFC 9110 and the API Handyman survey (94% 404 / 2% 410).
//                   Extend to include 403 if the target soft-hides deleted rows.
//   softDelete    — when true, skip the oracle on DELETE entirely; a 200 on GET
//                   after a soft-delete is correct, not a bug (B12).
//
// The client is injected, not constructed here. Callers pass sharedJarClient(page)
// so the verification read shares the live session cookie jar — no auth drift.
// APIRequestContext.fetch() runs outside the browser's network event stack, so
// oracle GETs never appear in page.events or page.captures for the current step.
//
// Prior art: Schemathesis `use_after_free` (DELETE → GET gone) and
// `ensure_resource_availability` (POST → GET exists).

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// 200, 201, 204 — mutation was accepted and committed.
// 202 Accepted is deliberately excluded: it signals async processing, so the
// resource may not be readable yet and a read would race the background job.
const COMMITTED_STATUSES = new Set([200, 201, 204]);

// Common response shapes for a newly-created resource. Covers top-level id
// and a single-key data wrapper (JSON:API / FastAPI default).
const ID_KEYS = ['id', 'uuid'];

function tryExtractCreatedId(body) {
  if (!body || typeof body !== 'object') return null;
  for (const key of ID_KEYS) {
    const val = body[key];
    if (val !== undefined && val !== null) return String(val);
  }
  // single-key wrapper: { data: { id: 42 } } or { item: { id: 42 } }
  const keys = Object.keys(body);
  if (keys.length === 1) {
    const inner = body[keys[0]];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return tryExtractCreatedId(inner);
    }
  }
  return null;
}

// Mirrors navigate.js: allowedDomains uses hostname suffix matching so that
// localhost covers both localhost:5173 (UI) and localhost:8000 (API).
function isAllowedDomain(url, allowedDomains) {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  try {
    const host = new URL(url).hostname;
    return allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// Find the most recent committed mutation on an allowed domain.
// Scans in reverse so the last write of a step is what we verify — multiple
// mutations in one step (e.g. macro) are uncommon but the final one is the
// most likely source of the UI success signal.
function findMutation(captures, allowedDomains) {
  for (let i = captures.length - 1; i >= 0; i--) {
    const c = captures[i];
    if (!MUTATION_METHODS.has(c.method)) continue;
    if (!COMMITTED_STATUSES.has(c.status)) continue;
    if (!isAllowedDomain(c.url, allowedDomains)) continue;
    return c;
  }
  return null;
}

// Guard: the URL must end with the resource ID, not an action verb.
// POST /api/items/42/favorite has resource_id {id:'42'} but ends with "favorite"
// — it's an action endpoint, not a resource endpoint. Verifying it would produce
// a false STATE_NOT_PERSISTED because there is no GET /api/items/42/favorite route.
function urlEndsWithResourceId(cleanUrl, resourceId) {
  const lastSeg = cleanUrl.split('/').filter(Boolean).pop() ?? '';
  return lastSeg === String(resourceId.id);
}

// Resolve the URL to GET for verification and the check mode.
//   DELETE / PUT / PATCH: resource ID is in the request URL (W3 already parsed it).
//   POST to collection:   resource ID comes from the response body.
//   POST to resource URL: upsert pattern — ID is in the URL.
function resolveVerify(capture) {
  const { method, url, resource_id, responseBody } = capture;
  const cleanUrl = url.split('?')[0].replace(/\/+$/, '');

  if (method === 'DELETE' || method === 'PUT' || method === 'PATCH') {
    if (!resource_id) return null; // can't attribute without an ID in the URL
    if (!urlEndsWithResourceId(cleanUrl, resource_id)) return null; // action endpoint
    return { verifyUrl: cleanUrl, mode: method === 'DELETE' ? 'delete' : 'persist' };
  }

  if (method === 'POST') {
    if (resource_id) {
      if (!urlEndsWithResourceId(cleanUrl, resource_id)) return null; // action endpoint
      return { verifyUrl: cleanUrl, mode: 'persist' };
    }
    const createdId = tryExtractCreatedId(responseBody);
    if (!createdId) return null;
    return { verifyUrl: `${cleanUrl}/${createdId}`, mode: 'persist' };
  }

  return null;
}

// Poll until predicate(response) is true or attempts are exhausted.
// Early exit on predicate satisfaction — avoids unnecessary retries on fast backends.
// Returns { satisfied: boolean, last: {status, body} | null }.
async function pollUntil(client, url, predicate, { maxAttempts, delayMs }) {
  let last = null;
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      last = await client.fetch(url);
      if (predicate(last)) return { satisfied: true, last };
    } catch { /* network error — don't count as predicate failure, retry */ }
  }
  return { satisfied: false, last };
}

/**
 * Check whether a committed mutation's effect is visible via the API.
 *
 * @param {object} opts
 * @param {Array}  opts.captures      - step's newCaptures slice from network.js
 * @param {object} opts.client        - sharedJarClient(page.raw) — same session jar
 * @param {Array}  opts.allowedDomains - from config.target.allowedDomains
 * @param {object} opts.config        - oracle.crossLayer config block
 * @returns {{ signal: string|null, detail?: string }}
 */
export async function checkCrossLayer({ captures, client, allowedDomains = [], config = {} }) {
  const {
    enabled = true,
    pollAttempts = 3,
    pollDelayMs = 500,
    goneStatuses = [404, 410],
    softDelete = false,
  } = config;

  if (!enabled || !captures?.length) return { signal: null };

  const mutation = findMutation(captures, allowedDomains);
  if (!mutation) return { signal: null };

  const verify = resolveVerify(mutation);
  if (!verify) return { signal: null };

  const goneSet = new Set(goneStatuses);
  const { verifyUrl, mode } = verify;

  if (mode === 'delete') {
    if (softDelete) return { signal: null };
    const { satisfied, last } = await pollUntil(
      client, verifyUrl, (r) => goneSet.has(r.status),
      { maxAttempts: pollAttempts, delayMs: pollDelayMs },
    );
    if (satisfied || !last) return { signal: null };
    return {
      signal: 'STATE_NOT_DELETED',
      detail: `DELETE ${mutation.url} → ${mutation.status}; GET ${verifyUrl} still ${last.status} after ${pollAttempts} poll(s)`,
    };
  }

  // mode === 'persist' (POST / PUT / PATCH)
  const { satisfied, last } = await pollUntil(
    client, verifyUrl, (r) => !goneSet.has(r.status),
    { maxAttempts: pollAttempts, delayMs: pollDelayMs },
  );
  if (satisfied || !last) return { signal: null };
  return {
    signal: 'STATE_NOT_PERSISTED',
    detail: `${mutation.method} ${mutation.url} → ${mutation.status}; GET ${verifyUrl} returned ${last.status} after ${pollAttempts} poll(s)`,
  };
}
