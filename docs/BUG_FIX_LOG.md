# Heuristic Monkey — Bug Fix Log

Entry heading: `DD/MM/YYYY — fix(scope component): short title`
Body: 3–6 bullets — cause, fix, downstream risk. No code blocks.
Scopes: `agent` · `browser` · `perception` · `actions` · `llm` · `observability` · `triage` · `config` · `infra` · `docs`

---

06/05/2026 — fix(observability otel): use Resource class instead of resourceFromAttributes
- Import broke at startup with "does not provide an export named 'resourceFromAttributes'".
- Cause: `@opentelemetry/resources@1.30.1` ships the `Resource` class only; `resourceFromAttributes` was added in 2.x.
- Fix: imported `Resource` and constructed it directly with the same attributes object.
- Caught by the bug-hunter subagent during scaffold verification — agent process exited before any browser launched.
- Downstream risk: when we eventually upgrade to `@opentelemetry/resources@2.x` we'll want to flip back to `resourceFromAttributes` for cleaner ergonomics; both APIs accept the same attribute shape.

---

15/06/2026 — fix(agent structural): broken-image oracle blind to cross-origin first-party images
- Cause: checkBrokenImages gated on exact `new URL(src).origin === targetOrigin`, so any first-party image served from a sibling host or port was treated as third-party and excluded.
- Impact in the field: PetrCollect UI on :3000 with images on :8000/static, and Lovable apps whose product images load from <project>.supabase.co, were structurally unscannable — the oracle could never fire on them.
- Fix: pass config.target.allowedDomains into the oracle and match on hostname suffix (host === d || host.endsWith('.'+d)), mirroring the existing isAllowedDomain helper in crossLayer.js / navigate.js.
- Divergence from crossLayer: an empty allowedDomains list falls back to exact-origin equality rather than allow-all, so failed third-party images still never fire when no domains are configured.
- Downstream risk: low — behavior is unchanged when allowedDomains is empty; coverage only widens to hosts the operator has already whitelisted. New coverage (e.g. supabase.co) is one config line.

---

16/06/2026 — fix(perception httpSignals): stop auto-asserting benign request failures and third-party pageerrors
- Cause: REQUEST_FAILED mapped every non-noise failure to an auto-assert ASSET_4XX without reading the failure reason; PAGEERROR had no origin/denylist filter.
- Impact: SPA route changes abort in-flight fetches (ERR_ABORTED) and ad-blockers cancel beacons — each wrote a false BUG report on any data-fetching React app; extension/ResizeObserver throws auto-asserted critical against the app.
- Fix: isBenignFailure drops ERR_ABORTED/ERR_BLOCKED_BY_*/transient resets to evidence-only; isPageErrorNoise drops chrome/moz-extension and ResizeObserver-loop throws. Genuine hard failures (ERR_CONNECTION_REFUSED, DNS, cert) still fire.
- Downstream risk: low — a null/unknown failure reason still fires (conservative); the benign list is reason-substring matched, so a future Chromium reason rename would need a list update.

---

16/06/2026 — fix(agent crossLayer): PostgREST/Supabase false positives on delete and insert verification
- Cause: the oracle compared HTTP status only; PostgREST returns 200 + [] for a gone row (not 404/410) and addresses rows by ?id=eq.<id>, not /<table>/<id>.
- Impact: STATE_NOT_DELETED false-fired on every successful Supabase delete; STATE_NOT_PERSISTED false-fired on representation inserts (path-style verify URL 404s) and silently skipped default inserts.
- Fix: isAbsent treats an empty 2xx array as gone; resolveVerify builds ?key=eq.value verify URLs for created PostgREST rows; tryExtractCreatedId handles the single-row representation array and returns {key,value}.
- Downstream risk: existence-only still (a wrong-value update reads 200 and passes); multi-row and default-empty inserts remain unverified — false negatives, not false positives.

---

16/06/2026 — fix(agent apiClient): cross-layer oracle crashed on the Puppeteer fallback arm
- Cause: sharedJarClient called page.context().request unconditionally; Puppeteer pages have no context().request, so it threw mid-step.
- Fix: return null when no Playwright request context is present; index.js skips checkCrossLayer when the client is null.
- Downstream risk: the cross-layer oracle is a no-op on the Puppeteer arm (documented limitation) until a header-based Puppeteer verify client is built.
