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
//   4. First-party origin gate — third-party images that fail are out of scope.
//
// Scored at 0.35 / flag-for-review because onerror placeholder-swap (the dominant
// production failure mode) replaces the src before complete fires, bypassing this
// check. The signal is credible but not unambiguous.

export async function checkBrokenImages(page, targetOrigin) {
  try {
    const broken = await page.raw.evaluate((origin) => {
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
          try {
            return new URL(el.src).origin === origin;
          } catch {
            return false;
          }
        })
        .map((el) => el.src);
    }, targetOrigin);

    if (!broken.length) return { signal: null };
    return {
      signal: 'BROKEN_IMAGE',
      detail: `${broken.length} broken first-party image(s): ${broken.slice(0, 3).join(', ')}`,
    };
  } catch {
    return { signal: null };
  }
}
