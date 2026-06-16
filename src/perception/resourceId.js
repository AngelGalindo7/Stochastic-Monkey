const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^\d+$/;
const STATIC_EXT_RE = /\.[a-z0-9]+$/i;
const META_SEGMENTS = new Set(['health', 'ping', 'status', 'metrics', 'favicon.ico']);

// Regex covers v1..v999+ — the verifier flagged a hardcoded Set stopping at v10
// as a false-positive source for any API versioned at v11+.
function isVersionOrPrefix(seg) {
  return seg === 'api' || /^v\d+$/i.test(seg);
}

function isId(seg) {
  return UUID_RE.test(seg) || INT_RE.test(seg);
}

function isWord(seg) {
  return !isId(seg) && !isVersionOrPrefix(seg) && seg.length > 0;
}

// PostgREST filter format: ?<column>=eq.<value>  (e.g. ?id=eq.42)
// Only id/uuid columns are safe to treat as the primary resource key.
// Collection = last non-version path segment (e.g. /rest/v1/items → items).
function extractFromPostgRESTParams(url) {
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    for (const key of ['id', 'uuid']) {
      const val = params.get(key);
      if (!val) continue;
      const match = val.match(/^eq\.(.+)$/);
      if (!match || !isId(match[1])) continue;
      const segs = parsed.pathname.split('/').filter(Boolean).filter((s) => !isVersionOrPrefix(s));
      const collection = segs[segs.length - 1];
      if (!collection || !isWord(collection)) continue;
      return { collection, id: match[1] };
    }
  } catch {}
  return null;
}

/**
 * Extracts REST resource attribution from a URL.
 *
 * Primary: walks path segments right-to-left for <collection>/<id> pairs.
 * Fallback: parses PostgREST-style query params (?id=eq.42) when path yields nothing.
 * Returns null for non-resource paths (collections, static assets, meta endpoints).
 *
 * @param {string} url
 * @returns {{ collection: string, id: string, parentCollection?: string, parentId?: string } | null}
 */
export function extractResourceId(url) {
  try {
    if (!url || typeof url !== 'string') return null;

    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      const q = path.indexOf('?');
      if (q !== -1) path = path.slice(0, q);
      const h = path.indexOf('#');
      if (h !== -1) path = path.slice(0, h);
    }

    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    if (segments.some((s) => STATIC_EXT_RE.test(s))) return null;
    if (segments.some((s) => META_SEGMENTS.has(s.toLowerCase()))) return null;

    const pairs = [];
    let i = segments.length - 1;
    while (i >= 0 && pairs.length < 2) {
      const seg = segments[i];
      if (isId(seg)) {
        let j = i - 1;
        while (j >= 0 && isVersionOrPrefix(segments[j])) j--;
        if (j >= 0 && isWord(segments[j])) {
          pairs.push({ collection: segments[j], id: seg });
          i = j - 1;
          continue;
        }
        if (j < 0) return null;
      }
      i--;
    }

    if (pairs.length === 0) return extractFromPostgRESTParams(url);

    const result = { collection: pairs[0].collection, id: pairs[0].id };
    if (pairs.length >= 2) {
      result.parentCollection = pairs[1].collection;
      result.parentId = pairs[1].id;
    }
    return result;
  } catch {
    return null;
  }
}
