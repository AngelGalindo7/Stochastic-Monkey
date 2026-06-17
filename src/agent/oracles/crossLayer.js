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

// Common response shapes for a newly-created resource. Covers top-level id, a
// single-key data wrapper (JSON:API / FastAPI default), and the single-row
// representation array PostgREST/Supabase returns. Returns { key, value } so the
// verify URL can filter on the right column, or null when no id is extractable.
const ID_KEYS = ['id', 'uuid'];

function tryExtractCreatedId(body) {
  if (!body || typeof body !== 'object') return null;
  // PostgREST/Supabase `Prefer: return=representation` insert returns [{...}].
  // Verify only single-row inserts — multi-row/empty are ambiguous for a single id.
  if (Array.isArray(body)) {
    return body.length === 1 ? tryExtractCreatedId(body[0]) : null;
  }
  for (const key of ID_KEYS) {
    const val = body[key];
    if (val !== undefined && val !== null) return { key, value: String(val) };
  }
  // single-key wrapper: { data: { id: 42 } } or { item: { id: 42 } }
  const keys = Object.keys(body);
  if (keys.length === 1) {
    const inner = body[keys[0]];
    if (inner && typeof inner === 'object') return tryExtractCreatedId(inner);
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

// PostgREST-style resource check: ?id=eq.<value> or ?uuid=eq.<value>.
// When true, the full URL (with query string) is the correct verify URL — stripping
// it would produce a collection endpoint, not a resource endpoint.
function isPostgRESTResourceUrl(url, resourceId) {
  try {
    const params = new URL(url).searchParams;
    for (const key of ['id', 'uuid']) {
      const val = params.get(key);
      if (!val) continue;
      const match = val.match(/^eq\.(.+)$/);
      if (match && match[1] === String(resourceId.id)) return true;
    }
  } catch {}
  return false;
}

// Supabase/PostgREST mounts collections at /rest/v<n>/<table> and addresses a single
// row by query filter (?id=eq.<id>), NOT by a /<table>/<id> path. Detect that mount
// so a created-row verify URL uses the filter the backend actually routes — a path
// like /rest/v1/items/42 would 404 even though the row persisted correctly.
function isPostgRESTCollectionUrl(url) {
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean);
    return segs.some((s, i) => s === 'rest' && /^v\d+$/i.test(segs[i + 1] ?? ''));
  } catch {
    return false;
  }
}

// Resolve the URL to GET for verification and the check mode.
//   DELETE / PUT / PATCH: resource ID is in the request URL (W3 already parsed it).
//   POST to collection:   resource ID comes from the response body.
//   POST to resource URL: upsert pattern — ID is in the URL.
//
// Two URL shapes are supported:
//   Path-based    /api/items/42            → verifyUrl strips query string
//   PostgREST     /rest/v1/items?id=eq.42  → verifyUrl keeps the query filter
function resolveVerify(capture) {
  const { method, url, resource_id, responseBody } = capture;
  const cleanUrl = url.split('?')[0].replace(/\/+$/, '');
  const fullUrl  = url.replace(/#.*$/, '').replace(/\/+$/, '');

  if (method === 'DELETE' || method === 'PUT' || method === 'PATCH') {
    if (!resource_id) return null; // can't attribute without an ID in the URL
    if (urlEndsWithResourceId(cleanUrl, resource_id)) {
      return { verifyUrl: cleanUrl, mode: method === 'DELETE' ? 'delete' : 'persist' };
    }
    if (isPostgRESTResourceUrl(fullUrl, resource_id)) {
      return { verifyUrl: fullUrl, mode: method === 'DELETE' ? 'delete' : 'persist' };
    }
    return null; // action endpoint or unrecognized URL shape
  }

  if (method === 'POST') {
    if (resource_id) {
      if (urlEndsWithResourceId(cleanUrl, resource_id)) {
        return { verifyUrl: cleanUrl, mode: 'persist' };
      }
      if (isPostgRESTResourceUrl(fullUrl, resource_id)) {
        return { verifyUrl: fullUrl, mode: 'persist' };
      }
      return null; // action endpoint
    }
    const created = tryExtractCreatedId(responseBody);
    if (!created) return null;
    // PostgREST addresses the new row by filter; path-style REST by /<collection>/<id>.
    const verifyUrl = isPostgRESTCollectionUrl(cleanUrl)
      ? `${cleanUrl}?${created.key}=eq.${created.value}`
      : `${cleanUrl}/${created.value}`;
    return { verifyUrl, mode: 'persist' };
  }

  return null;
}

// Poll until predicate(response) is true or attempts are exhausted.
// Early exit on predicate satisfaction — avoids unnecessary retries on fast backends.
// fetchOptions is forwarded to client.fetch on every attempt — carries auth headers
// captured from the original mutation (e.g. Supabase apikey + Authorization).
// Returns { satisfied: boolean, last: {status, body} | null }.
async function pollUntil(client, url, predicate, { maxAttempts, delayMs, fetchOptions = {} }) {
  let last = null;
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      last = await client.fetch(url, fetchOptions);
      if (predicate(last)) return { satisfied: true, last };
    } catch { /* network error — don't count as predicate failure, retry */ }
  }
  return { satisfied: false, last };
}

// Decide whether a verification read shows the resource as ABSENT.
//   - status in goneStatuses (404/410, path-style REST) → absent.
//   - PostgREST returns 200 with a JSON array for a ?col=eq. filter read: a present
//     row is a non-empty array, a gone row is []. A status-only check is blind to this
//     (both are 200), so judge by the body when it is an array.
function isAbsent(response, goneSet) {
  if (!response) return false;
  if (goneSet.has(response.status)) return true;
  if (response.status >= 200 && response.status < 300 && Array.isArray(response.body)) {
    return response.body.length === 0;
  }
  return false;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T|\s)/;

// Returns a flat { field: primitiveValue } map of the fields the monkey wrote.
// Skips nulls, objects, arrays, and ISO-date strings — server normalization of
// timestamps is legitimate and would produce false positives on string comparison.
// Returns null when requestBody is not a plain non-array object or no primitive
// fields survive the filter.
function extractWrittenFields(requestBody) {
  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) return null;
  const out = {};
  for (const [k, v] of Object.entries(requestBody)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    if (typeof v === 'string' && ISO_DATE_RE.test(v)) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// Compare written fields against the verify GET response body.
// Unwraps single-row PostgREST arrays (length === 1). Fields absent from the
// response body are silently skipped — projection/sparse reads are not a bug.
// Comparison uses String() coercion: server stores 42 (int), request sent "42"
// (string from form input) — semantically equal, must not fire.
function findMismatchedFields(writtenFields, responseBody) {
  let body = responseBody;
  if (Array.isArray(body)) {
    if (body.length !== 1) return [];
    body = body[0];
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const mismatches = [];
  for (const [field, written] of Object.entries(writtenFields)) {
    if (!(field in body)) continue;
    const got = body[field];
    if (got === null || got === undefined) continue;
    if (typeof got === 'object') continue;
    if (String(got) !== String(written)) mismatches.push({ field, written, got });
  }
  return mismatches;
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
  // Forward auth headers captured from the original mutation (e.g. Supabase apikey +
  // Authorization). Falls back to cookie-jar-only when no headers were captured.
  const fetchOptions = mutation.requestHeaders ? { headers: mutation.requestHeaders } : {};

  if (mode === 'delete') {
    if (softDelete) return { signal: null };
    const { satisfied, last } = await pollUntil(
      client, verifyUrl, (r) => isAbsent(r, goneSet),
      { maxAttempts: pollAttempts, delayMs: pollDelayMs, fetchOptions },
    );
    if (satisfied || !last) return { signal: null };
    return {
      signal: 'STATE_NOT_DELETED',
      detail: `DELETE ${mutation.url} → ${mutation.status}; GET ${verifyUrl} still ${last.status} after ${pollAttempts} poll(s)`,
    };
  }

  // mode === 'persist' (POST / PUT / PATCH)
  const { satisfied, last } = await pollUntil(
    client, verifyUrl, (r) => !isAbsent(r, goneSet),
    { maxAttempts: pollAttempts, delayMs: pollDelayMs, fetchOptions },
  );
  if (!last) return { signal: null };
  if (!satisfied) {
    return {
      signal: 'STATE_NOT_PERSISTED',
      detail: `${mutation.method} ${mutation.url} → ${mutation.status}; GET ${verifyUrl} returned ${last.status} after ${pollAttempts} poll(s)`,
    };
  }
  // Resource persisted — check content fidelity for PUT/PATCH with a request body.
  // flag-for-review (not auto-assert): server-side normalization (trimming, lowercasing,
  // timestamp formatting) can legitimately produce different string values.
  if ((mutation.method === 'PUT' || mutation.method === 'PATCH') && mutation.requestBody) {
    const writtenFields = extractWrittenFields(mutation.requestBody);
    if (writtenFields) {
      const mismatches = findMismatchedFields(writtenFields, last.body);
      if (mismatches.length) {
        return {
          signal: 'STATE_WRONG_VALUE',
          detail: `${mutation.method} ${mutation.url}; GET ${verifyUrl} has wrong values: ${mismatches.map((m) => `${m.field} (wrote ${JSON.stringify(m.written)}, got ${JSON.stringify(m.got)})`).join(', ')}`,
        };
      }
    }
  }
  return { signal: null };
}
