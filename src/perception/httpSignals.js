import { CONSOLE_ERROR_DENYLIST, isFirstPartyConsoleError } from '../agent/signals.js';
import { isFirstPartyUrl } from './firstParty.js';

export { CONSOLE_ERROR_DENYLIST, isFirstPartyConsoleError };

// Telemetry/analytics/asset URLs whose 4xx or failure is background noise, not
// a defect in the app under test.
const NOISE_PATTERNS = [
  /\/favicon\.ico$/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /doubleclick\.net/i,
  /facebook\.com\/tr/i,
];

export function isNoiseUrl(url) {
  if (!url) return false;
  return NOISE_PATTERNS.some((re) => re.test(url));
}

// Network failure reasons that are routine cancellation/blocking, not an app defect.
// SPA navigation aborts in-flight fetches (React Query / SWR / AbortController →
// ERR_ABORTED); ad-blockers and admin policy cancel beacons (ERR_BLOCKED_BY_*);
// transient connectivity resets the socket. A REQUEST_FAILED carrying one of these
// is recorded as evidence only — never auto-asserted as a broken-resource bug.
const BENIGN_FAILURE_REASONS = [
  'ERR_ABORTED',
  'ERR_BLOCKED_BY_CLIENT',
  'ERR_BLOCKED_BY_ADMINISTRATOR',
  'ERR_BLOCKED_BY_RESPONSE',
  'ERR_NETWORK_CHANGED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_ABORTED',
];

export function isBenignFailure(reason) {
  if (!reason) return false; // unknown reason — treat as a real failure (conservative)
  return BENIGN_FAILURE_REASONS.some((r) => reason.includes(r));
}

// Transient environmental failures — DNS resolution, connection refusal, socket
// timeouts. Unlike a genuine broken-resource bug these are non-deterministic: they
// depend on network conditions at crawl time and will not reproduce in deterministic
// replay. Auto-asserting them fills BUG/ with non-reproducible noise, so they are
// recorded as evidence only (same treatment as BENIGN_FAILURE_REASONS).
const TRANSIENT_FAILURE_REASONS = [
  'ERR_TIMED_OUT',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_CONNECTION_REFUSED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_ADDRESS_UNREACHABLE',
];

export function isTransientFailure(reason) {
  if (!reason) return false;
  return TRANSIENT_FAILURE_REASONS.some((r) => reason.includes(r));
}

// Uncaught exceptions that originate outside the app under test (browser extensions)
// or are benign browser-internal throws (ResizeObserver loop notifications). The
// PAGEERROR channel has no origin filter (unlike CONSOLE_ERROR), so screen these out
// before auto-asserting a critical bug against the app.
const PAGEERROR_NOISE = [
  /chrome-extension:\/\//,
  /moz-extension:\/\//,
  /ResizeObserver loop/,
];

export function isPageErrorNoise(event) {
  const haystack = `${event?.message ?? ''}\n${event?.stack ?? ''}`;
  return PAGEERROR_NOISE.some((re) => re.test(haystack));
}

// URL-like frame references in an Error.stack. Frame formats vary across engines
// (V8 "at fn (url:line:col)" / "at url:line:col"; Firefox "fn@url:line:col") but a
// scheme-prefixed substring is common to all. A trailing :line:col is parsed as part
// of the URL path, so origin/hostname comparison still works without stripping it.
const STACK_FRAME_URL_RE = /\b(?:https?|file|chrome-extension|moz-extension):\/\/[^\s)'"]+/gi;

// Attribute an uncaught exception to the app under test via its stack frames. A throw
// from a third-party SDK (Stripe.js, Intercom, an analytics script) should not auto-
// assert a CRITICAL bug against the app — CONSOLE_ERROR already attributes origin, so
// PAGEERROR must too. Mirrors isFirstPartyConsoleError's conservative default: when no
// frame URL can be extracted (inline/anonymous script, minified throw with no stack)
// the error is treated as first-party so genuine inline app crashes are never lost.
export function isFirstPartyPageError(event, targetOrigin = '', allowedDomains = []) {
  const frames = `${event?.stack ?? ''}`.match(STACK_FRAME_URL_RE);
  if (!frames || frames.length === 0) return true;
  return frames.some((url) => isFirstPartyUrl(url, { targetOrigin, allowedDomains }));
}

// Static sub-resources whose 4xx is a broken-asset bug (missing image, dead
// stylesheet). Distinguished from API (xhr/fetch) 4xx, which is usually correct
// rejection of bad input and must NOT auto-fire a bug.
const ASSET_RESOURCE_TYPES = new Set(['image', 'stylesheet', 'font', 'media', 'script', 'texttrack']);

// Status codes that are 5xx but not unambiguous server faults: 503 (rate limit /
// maintenance window) and 504 (upstream gateway timeout) are legitimate,
// retryable infra responses, not defects in the app under test. They are flagged
// for review (HTTP_503_504 evidence) rather than auto-asserted as bugs.
const REVIEW_5XX = new Set([503, 504]);

// Map captured page events to the deterministic bug oracle. HTTP status codes
// drive this. A 500-class 5xx (500/501/502/505+) is a server fault that
// auto-asserts the HTTP_500 hard signal; 503/504 are flagged for review (see
// REVIEW_5XX). A 4xx is classified by the request it answered: navigation
// (broken route) and assets are bugs, API validation 4xx is evidence only.
//
// allowedDomains gates which response/error URLs are attributable to the app under
// test (isFirstPartyUrl): a third-party 500, asset 404, or uncaught throw must NOT
// auto-assert a bug. An empty list falls back to exact targetOrigin equality, not
// allow-all (see firstParty.js).
export function pageEventsToHardSignals(events, targetOrigin = '', allowedDomains = []) {
  const out = [];
  const evidence = [];
  const isFirstParty = (url) => isFirstPartyUrl(url, { targetOrigin, allowedDomains });
  for (const e of events) {
    if (e.type === 'PAGEERROR') {
      if (isPageErrorNoise(e) || !isFirstPartyPageError(e, targetOrigin, allowedDomains)) {
        evidence.push({ signal: 'PAGEERROR_NOISE', detail: e.message });
      } else {
        out.push('PAGEERROR');
        evidence.push({ signal: 'PAGEERROR', detail: e.message });
      }
    } else if (e.type === 'HTTP_5XX') {
      if (!isFirstParty(e.url)) {
        // Third-party 5xx (payment sandbox, search widget, analytics) is not a fault
        // in the app under test — evidence only, never auto-assert.
        evidence.push({ signal: 'THIRD_PARTY_5XX', detail: `${e.status} ${e.url}` });
      } else if (REVIEW_5XX.has(e.status)) {
        // 503/504: credible but ambiguous — flag for review, never auto-assert (cf. API_4XX).
        out.push('HTTP_503_504');
        evidence.push({ signal: 'HTTP_503_504', detail: `${e.status} ${e.url}` });
      } else {
        out.push('HTTP_500');
        evidence.push({ signal: 'HTTP_500', detail: `${e.status} ${e.url}` });
      }
    } else if (e.type === 'HTTP_4XX' && !isNoiseUrl(e.url)) {
      if (e.resourceType === 'document') {
        out.push('HTTP_4XX_NAV');
        evidence.push({ signal: 'HTTP_4XX_NAV', detail: `${e.status} ${e.url}` });
      } else if (ASSET_RESOURCE_TYPES.has(e.resourceType)) {
        if (isFirstParty(e.url)) {
          out.push('ASSET_4XX');
          evidence.push({ signal: 'ASSET_4XX', detail: `${e.status} ${e.url}` });
        } else {
          // Third-party asset 404 (CDN font, vendor script) — not the app's defect.
          evidence.push({ signal: 'THIRD_PARTY_ASSET_4XX', detail: `${e.status} ${e.url}` });
        }
      } else {
        // API (xhr/fetch/other) 4xx: evidence for later deduction, not a bug.
        evidence.push({ signal: 'API_4XX', detail: `${e.status} ${e.url}` });
      }
    } else if (e.type === 'REQUEST_FAILED' && !isNoiseUrl(e.url)) {
      if (isBenignFailure(e.reason)) {
        evidence.push({ signal: 'REQUEST_FAILED_BENIGN', detail: `${e.reason} ${e.url}` });
      } else if (isTransientFailure(e.reason)) {
        evidence.push({ signal: 'REQUEST_FAILED_TRANSIENT', detail: `${e.reason} ${e.url}` });
      } else if (e.resourceType && !ASSET_RESOURCE_TYPES.has(e.resourceType)) {
        // Failed API (xhr/fetch) request — not a broken asset; evidence for deduction,
        // not an ASSET_4XX. (Events without a resourceType fall through to the gate
        // below so legacy callers still surface genuine asset failures.)
        evidence.push({ signal: 'API_REQUEST_FAILED', detail: `${e.reason} ${e.url}` });
      } else if (!isFirstParty(e.url)) {
        evidence.push({ signal: 'THIRD_PARTY_REQUEST_FAILED', detail: `${e.reason} ${e.url}` });
      } else {
        out.push('ASSET_4XX');
        evidence.push({ signal: 'REQUEST_FAILED', detail: `fail ${e.url}` });
      }
    } else if (e.type === 'CONSOLE_ERROR') {
      const msg = e.message ?? '';
      if (!CONSOLE_ERROR_DENYLIST.some((re) => re.test(msg)) && isFirstPartyConsoleError(e, targetOrigin)) {
        out.push('CONSOLE_ERROR');
        evidence.push({ signal: 'CONSOLE_ERROR', detail: msg });
      }
    } else if (e.type === 'DOM_FROZEN') {
      out.push('DOM_FROZEN');
      evidence.push({ signal: 'DOM_FROZEN', detail: 'SPA root has no children after settle' });
    }
  }
  return { signals: out, evidence };
}
