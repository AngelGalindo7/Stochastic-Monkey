// B4 structural oracle — app-agnostic DOM invariants.
//
// checkBrokenImages covers the gap left by ASSET_4XX: images that received an
// HTTP 200 but failed to decode (naturalWidth === 0 after complete === true).
// ASSET_4XX already fires on HTTP-level failures; this catches the silent case
// where the browser loaded a response but couldn't render it (corrupted data,
// zero-byte body, malformed data URI).
//
// Four guards prevent false positives on common SPA patterns:
//   1. Skip empty src / src === baseURI (no image set yet).
//   2. Skip SVGs — naturalWidth is legitimately 0 in Chromium for SVGs loaded
//      via <img> without explicit width/height attributes.
//   3. Skip lazy images whose bounding rect is below the viewport — the browser
//      hasn't started the decode yet so naturalWidth is always 0.
//   4. First-party gate — third-party images that fail are out of scope. Uses the
//      same hostname-suffix matching as crossLayer/navigate (allowedDomains) so a
//      first-party image served from a sibling host or port still counts: e.g. a
//      UI on localhost:3000 with images on localhost:8000/static, or a Lovable app
//      whose product images come from <project>.supabase.co. Falls back to exact
//      origin equality when allowedDomains is empty — unlike crossLayer, an empty
//      list does NOT mean allow-all here, or every failed third-party image would fire.
//
// Scored at 0.35 / flag-for-review because onerror placeholder-swap (the dominant
// production failure mode) replaces the src before complete fires, bypassing this
// check. The signal is credible but not unambiguous.

export async function checkBrokenImages(page, targetOrigin, allowedDomains = []) {
  try {
    const broken = await page.raw.evaluate(({ origin, domains }) => {
      const isFirstParty = (src) => {
        try {
          const url = new URL(src);
          if (domains.length === 0) return url.origin === origin;
          return domains.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`));
        } catch {
          return false;
        }
      };
      return Array.from(document.querySelectorAll('img'))
        .filter((el) => {
          if (!el.src || el.src === document.baseURI) return false;
          const src = el.currentSrc || el.src;
          if (/\.svg($|\?)/i.test(src) || src.startsWith('data:image/svg')) return false;
          if (el.loading === 'lazy') {
            const rect = el.getBoundingClientRect();
            if (rect.top > window.innerHeight) return false;
          }
          if (!el.complete || el.naturalWidth !== 0 || el.naturalHeight !== 0) return false;
          return isFirstParty(el.src);
        })
        .map((el) => el.src);
    }, { origin: targetOrigin, domains: allowedDomains ?? [] });

    if (!broken.length) return { signal: null };
    return {
      signal: 'BROKEN_IMAGE',
      detail: `${broken.length} broken first-party image(s): ${broken.slice(0, 3).join(', ')}`,
    };
  } catch {
    return { signal: null };
  }
}
