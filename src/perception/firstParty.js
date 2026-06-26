// Shared "is this URL the app under test?" matcher. Extracted from the identical
// isAllowedDomain shape that was copied into crossLayer.js, authzReplay.js, and
// structural.js, so the perception-layer hard-signal gate (httpSignals.js) reuses
// one matcher instead of adding a fifth copy. See DECISION_LOG 019.
//
// Semantics:
//   - allowedDomains non-empty → hostname-suffix match (host === d || host endsWith
//     `.d`). A first-party API on a sibling host/port still counts: localhost:8000
//     for a UI on localhost:5173, or <project>.supabase.co.
//   - allowedDomains empty + targetOrigin known → exact origin equality. An empty
//     list does NOT mean allow-all when an origin is known, or every third-party
//     asset/500/error would be attributed to the app (mirrors structural.js).
//   - allowedDomains empty + no targetOrigin → allow-all. This preserves the
//     crossLayer/authzReplay contract: those oracles always run with domains
//     configured and never pass a targetOrigin, and their original isAllowedDomain
//     returned true on an empty list.
export function isFirstPartyUrl(url, { targetOrigin = '', allowedDomains = [] } = {}) {
  const hasList = Array.isArray(allowedDomains) && allowedDomains.length > 0;
  if (!hasList && !targetOrigin) return true;
  try {
    const { hostname, origin } = new URL(url);
    if (hasList) return allowedDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
    return origin === targetOrigin;
  } catch {
    return false;
  }
}
