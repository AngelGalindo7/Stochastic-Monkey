// Idempotency-key replay oracle.
//
// After a committed POST/PUT that carries a recognized idempotency key header,
// replays the same request with the same headers and compares the resource id in
// the replay response to the original. Two distinct non-null ids means the server
// created a second resource instead of honoring the key — IDEMPOTENCY_VIOLATION.
//
// Why auto-assert: String(originalId) !== String(replayId) with both non-null is
// unambiguous data duplication. The oracle never fires on null ids, missing keys,
// 204 (no body → no id comparison possible), non-first-party domains, or when
// disabled. See DECISION_LOG 020.
//
// Known gaps: cached-response masking (server returns first response verbatim but
// still creates a second row), server-rotated key patterns (Stripe: key is
// acknowledged then invalidated after first success), and x-request-id variants
// used for correlation rather than idempotency are all silent by design.

import { isFirstPartyUrl } from '../../perception/firstParty.js';
import { tryExtractCreatedId } from '../../perception/resourceId.js';

// Built-in idempotency header names captured by network.js.
// Custom keyHeaders config can narrow this set per target, but cannot ADD headers
// that network.js didn't capture — expansion requires updating AUTH_HEADER_KEYS.
export const DEFAULT_KEY_HEADERS = new Set([
  'idempotency-key',
  'x-idempotency-key',
  'idempotency_key',
  'x-request-id',
]);

const MUTATION_METHODS = new Set(['POST', 'PUT']);
// 204 excluded: no body means no id to compare.
const COMMITTED_STATUSES = new Set([200, 201]);

function findIdempotencyHeader(requestHeaders, keySet) {
  if (!requestHeaders || typeof requestHeaders !== 'object') return null;
  for (const [k, v] of Object.entries(requestHeaders)) {
    if (keySet.has(k.toLowerCase())) return { name: k.toLowerCase(), value: v };
  }
  return null;
}

/**
 * Check whether a committed mutation's idempotency key is honored by the server.
 *
 * @param {object}  opts
 * @param {Array}   opts.captures        - step's newCaptures slice from network.js
 * @param {object}  opts.client          - sharedJarClient(page.raw) — same session jar
 * @param {Array}   opts.allowedDomains  - from config.target.allowedDomains
 * @param {object}  opts.config          - oracle.idempotency config block
 * @param {object}  opts.replayCount     - mutable { value: number } shared across steps;
 *                                         caller initializes once per run before the step loop
 * @returns {{ signal: string|null, detail?: string }}
 */
export async function checkIdempotency({
  captures,
  client,
  allowedDomains = [],
  config = {},
  replayCount = { value: 0 },
}) {
  const {
    enabled = true,
    keyHeaders = null,
    maxReplaysPerRun = 5,
  } = config;

  if (!enabled || !client || !captures?.length) return { signal: null };

  // Build the active key set from config or fall back to the built-in default.
  const keySet = keyHeaders?.length
    ? new Set(keyHeaders.map((h) => h.toLowerCase()))
    : DEFAULT_KEY_HEADERS;

  for (const capture of captures) {
    if (!MUTATION_METHODS.has(capture.method)) continue;
    if (!COMMITTED_STATUSES.has(capture.status)) continue;
    if (!isFirstPartyUrl(capture.url, { allowedDomains })) continue;

    const idempHeader = findIdempotencyHeader(capture.requestHeaders, keySet);
    if (!idempHeader) continue;

    const originalId = tryExtractCreatedId(capture.responseBody);
    if (!originalId) continue; // 204 or no-body response — can't compare

    if (replayCount.value >= maxReplaysPerRun) return { signal: null };
    replayCount.value++;

    let replayResponse;
    try {
      replayResponse = await client.fetch(capture.url, {
        method: capture.method,
        headers: { ...(capture.requestHeaders ?? {}) },
        body: capture.requestBody != null ? JSON.stringify(capture.requestBody) : undefined,
      });
    } catch {
      continue; // network error — can't conclude anything
    }

    const replayId = tryExtractCreatedId(replayResponse?.body);
    if (!replayId) continue; // replay returned no parseable id — inconclusive

    if (String(originalId.value) !== String(replayId.value)) {
      return {
        signal: 'IDEMPOTENCY_VIOLATION',
        detail: `${capture.method} ${capture.url}: original ${originalId.key}=${originalId.value}, replay ${replayId.key}=${replayId.value} — ${idempHeader.name} not honored`,
      };
    }
  }

  return { signal: null };
}
