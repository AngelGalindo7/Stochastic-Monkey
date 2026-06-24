// Anonymous read-replay oracle (authorization / Row-Level-Security smell).
//
// Replays the resources the AUTHENTICATED arm read, as an UNAUTHENTICATED client,
// and flags any resource whose owned data still comes back without the user's token.
// This is the Supabase public-anon-key vector (CVE-2025-48757 class) and the OWASP
// API1:2023 BOLA shape — the dominant vibe-coded-app bug class.
//
// Deliberately conservative — it emits ONLY the flag-for-review verdict AUTHZ_UNCERTAIN,
// never an auto-asserted bug:
//   - Passive replay cannot prove the data is private vs. intentionally public (the
//     bytes are identical either way), so a human confirms. This mirrors Autorize and
//     BOLABuster, which both keep a human in the loop and publish no auto-FP rate.
//   - The auto-assert CROSS_ACCOUNT_LEAK verdict needs identity-grounded PROOF
//     (seed-a-marker-as-A, or a distinct peer account B that reads A's record). That
//     is deferred — see DECISION_LOG 015.
//
// What makes it identity-grounded (and therefore low-noise): it only fires when the
// anon replay returns the SAME owned record id(s) the authenticated arm saw — not just
// "anon got a 200". An empty/filtered/different body reads as correctly enforced.

import { isFirstPartyUrl } from '../../perception/firstParty.js';

const READ_METHODS = new Set(['GET']);
const is2xx = (s) => s >= 200 && s < 300;

// Markers that mean the authorization lives in the URL itself (pre-signed S3,
// capability / magic-link tokens, SAS). An anon replay of such a URL succeeding is
// by design, not a leak — exclude it.
const CAPABILITY_PARAM_RE =
  /(^|[?&])(x-amz-signature|x-amz-credential|x-amz-security-token|signature|sig|se|sp|sv|sr|st|token|access_token|jwt|expires|expiry|key)=/i;

function isCapabilityUrl(url) {
  try {
    return CAPABILITY_PARAM_RE.test(new URL(url).search);
  } catch {
    return false;
  }
}


// Collect id/uuid-like values from a response body (bounded depth/width) so the
// replay body can be checked for the SAME owned record the authed arm saw.
const ID_FIELDS = new Set(['id', 'uuid', 'user_id', 'owner_id', 'account_id', '_id', 'userId', 'ownerId', 'accountId', 'itemId', 'entryId', 'recordId', 'resourceId', 'createdBy', 'authorId']);

function collectIds(value, out = new Set(), depth = 0) {
  if (depth > 4 || out.size > 200 || value == null) return out;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 100)) collectIds(v, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if ((ID_FIELDS.has(k) || ID_FIELDS.has(k.toLowerCase())) && (typeof v === 'string' || typeof v === 'number')) {
        out.add(String(v));
      } else if (v && typeof v === 'object') {
        collectIds(v, out, depth + 1);
      }
    }
  }
  return out;
}

function bodyOverlap(ownedIds, replayBody) {
  if (!ownedIds.size) return false;
  const replayIds = collectIds(replayBody);
  for (const id of ownedIds) if (replayIds.has(id)) return true;
  return false;
}

// Search a response body (any depth) for the per-run sentinel string the monkey
// embedded via FORM_FILL. Finding it in the anon replay body is identity-grounded
// PROOF of a leak: only a value the authenticated arm just wrote can carry this
// marker, so it cannot be "intentionally public" prior data.
function bodyContainsSentinel(value, sentinel, depth = 0) {
  if (depth > 4 || value == null) return false;
  if (typeof value === 'string') return value.includes(sentinel);
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 50)) {
      if (bodyContainsSentinel(v, sentinel, depth + 1)) return true;
    }
    return false;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) {
      if (bodyContainsSentinel(v, sentinel, depth + 1)) return true;
    }
    return false;
  }
  return false;
}

// User session/bearer tokens stripped for the anon replay. `apikey` / `x-api-key` are
// KEPT because for Supabase-style backends they are the PUBLIC project key (without
// which PostgREST returns an infra 401 that masquerades as "enforced"). Assumption: an
// API that puts a PER-USER secret in apikey/x-api-key is out of scope for this passive
// oracle. Cookie-auth reads don't expose the credential in captured headers, so they
// are also out of scope (a true anon arm's own 401s cover enforcement there).
const USER_TOKEN_HEADERS = new Set(['authorization', 'x-auth-token']);

function hasUserToken(headers) {
  return !!headers && Object.keys(headers).some((k) => USER_TOKEN_HEADERS.has(k.toLowerCase()));
}

function anonHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (USER_TOKEN_HEADERS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Replay the authenticated arm's reads as an unauthenticated client.
 *
 * @param {object}      opts
 * @param {Array}       opts.reads          - the authenticated arm's captures (network.js shape)
 * @param {object}      opts.replay         - isolatedClient() — fresh, no cookies; fetch(url,{headers})→{status,body}
 * @param {Array}       opts.allowedDomains - config.target.allowedDomains
 * @param {object}      opts.config         - oracle.authzReplay config block
 * @param {string|null} opts.sentinel       - per-run sentinel from makeSentinel(seed); when present,
 *   reads whose body contains it are sentinel-grounded: if the anon replay also carries the
 *   sentinel, that is identity-grounded PROOF (emits CROSS_ACCOUNT_LEAK, not AUTHZ_UNCERTAIN).
 * @returns {Promise<{ signal: string|null, detail?: string, reason?: string }>}
 */
export async function checkAuthzReplay({ reads = [], replay, allowedDomains = [], config = {}, sentinel = null }) {
  const { enabled = true, maxReplays = 8, publicAllowlist = [] } = config;
  if (!enabled || !replay || !reads?.length) return { signal: null };

  const allow = publicAllowlist.map((p) => (p instanceof RegExp ? p : new RegExp(p)));
  const seen = new Set();
  const candidates = [];
  for (const c of reads) {
    if (!READ_METHODS.has(c.method)) continue;        // reads only
    if (!is2xx(c.status)) continue;                   // the user successfully read it
    if (!isFirstPartyUrl(c.url, { allowedDomains })) continue;
    if (!hasUserToken(c.requestHeaders)) continue;    // can't strip a credential we don't see
    if (isCapabilityUrl(c.url)) continue;             // auth is in the URL — by design
    if (allow.some((re) => re.test(c.url))) continue; // intentionally public
    const ownedIds = collectIds(c.responseBody);
    if (!ownedIds.size) continue;                     // nothing identity-grounded to assert on
    const key = c.url.split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    // hasSentinel: the sentinel the monkey wrote appears in this authenticated read body —
    // so if anon gets it back too, we have identity-grounded proof, not just id overlap.
    const hasSentinel = sentinel ? bodyContainsSentinel(c.responseBody, sentinel) : false;
    candidates.push({ url: key, headers: anonHeaders(c.requestHeaders), ownedIds, hasSentinel });
    if (candidates.length >= maxReplays) break;
  }
  if (!candidates.length) return { signal: null };

  const leaks = [];
  const sentinelLeaks = [];
  for (const cand of candidates) {
    let res;
    try {
      res = await replay.fetch(cand.url, { headers: cand.headers });
    } catch {
      continue; // network error replaying — don't guess
    }
    if (res && is2xx(res.status) && bodyOverlap(cand.ownedIds, res.body)) {
      leaks.push(cand.url);
      // Proven: the sentinel the monkey wrote is still visible to anon — cannot be
      // prior public data; the FORM_FILL that created it happened this session.
      if (cand.hasSentinel && bodyContainsSentinel(res.body, sentinel)) {
        sentinelLeaks.push(cand.url);
      }
    }
  }
  if (!leaks.length) return { signal: null };

  if (sentinelLeaks.length) {
    return {
      signal: 'CROSS_ACCOUNT_LEAK',
      detail: `anon replay returned sentinel-marked data without the user token for ${sentinelLeaks.length} endpoint(s): ${sentinelLeaks.slice(0, 3).join(', ')}`,
      reason:
        'A record the monkey wrote this session (carrying a unique sentinel marker) was readable by an ' +
        'unauthenticated replay. The sentinel cannot be pre-existing public data, so this is ' +
        'confirmed missing Row-Level Security (OWASP API1 BOLA / Supabase RLS-off).',
    };
  }

  return {
    signal: 'AUTHZ_UNCERTAIN',
    detail: `anon replay returned owned data without the user token for ${leaks.length} endpoint(s): ${leaks.slice(0, 3).join(', ')}`,
    reason:
      'A resource the signed-in user read came back to an unauthenticated replay carrying the same record id(s). ' +
      'Likely missing/broken Row-Level Security (OWASP API1 BOLA / Supabase RLS-off). ' +
      'Confirm the data is not intentionally public before treating as a leak.',
  };
}
