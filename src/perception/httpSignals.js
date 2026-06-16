import { CONSOLE_ERROR_DENYLIST, isFirstPartyConsoleError } from '../agent/signals.js';

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
export function pageEventsToHardSignals(events, targetOrigin = '') {
  const out = [];
  const evidence = [];
  for (const e of events) {
    if (e.type === 'PAGEERROR') {
      if (isPageErrorNoise(e)) {
        evidence.push({ signal: 'PAGEERROR_NOISE', detail: e.message });
      } else {
        out.push('PAGEERROR');
        evidence.push({ signal: 'PAGEERROR', detail: e.message });
      }
    } else if (e.type === 'HTTP_5XX') {
      if (REVIEW_5XX.has(e.status)) {
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
        out.push('ASSET_4XX');
        evidence.push({ signal: 'ASSET_4XX', detail: `${e.status} ${e.url}` });
      } else {
        // API (xhr/fetch/other) 4xx: evidence for later deduction, not a bug.
        evidence.push({ signal: 'API_4XX', detail: `${e.status} ${e.url}` });
      }
    } else if (e.type === 'REQUEST_FAILED' && !isNoiseUrl(e.url)) {
      if (isBenignFailure(e.reason)) {
        evidence.push({ signal: 'REQUEST_FAILED_BENIGN', detail: `${e.reason} ${e.url}` });
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
