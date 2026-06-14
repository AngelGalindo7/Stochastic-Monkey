import { CONSOLE_ERROR_DENYLIST, isFirstPartyConsoleError } from '../agent/signals.js';

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

// Static sub-resources whose 4xx is a broken-asset bug (missing image, dead
// stylesheet). Distinguished from API (xhr/fetch) 4xx, which is usually correct
// rejection of bad input and must NOT auto-fire a bug.
const ASSET_RESOURCE_TYPES = new Set(['image', 'stylesheet', 'font', 'media', 'script', 'texttrack']);

// Map captured page events to the deterministic bug oracle. HTTP status codes
// drive this — a 5xx is always a server fault; a 4xx is classified by the
// request it answered: navigation (broken route) and assets are bugs, API
// validation 4xx is recorded as evidence only.
export function pageEventsToHardSignals(events, targetOrigin = '') {
  const out = [];
  const evidence = [];
  for (const e of events) {
    if (e.type === 'PAGEERROR') {
      out.push('PAGEERROR');
      evidence.push({ signal: 'PAGEERROR', detail: e.message });
    } else if (e.type === 'HTTP_5XX') {
      out.push('HTTP_5XX');
      evidence.push({ signal: 'HTTP_5XX', detail: `${e.status} ${e.url}` });
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
      out.push('ASSET_4XX');
      evidence.push({ signal: 'REQUEST_FAILED', detail: `fail ${e.url}` });
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
