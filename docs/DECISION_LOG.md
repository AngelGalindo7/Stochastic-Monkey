# Heuristic Monkey — Decision Log

Numbered, monotonic, never renumbered. Format `### NNN — Title` then 3–6 bullets.

---

### 001 — Defer Hetzner / AWS Fargate cloud deployment

- **Context:** The architectural brief proposes a $23/mo Hetzner CPX42 VPS or AWS Fargate Spot containers (~$1.26/mo per task) to run the monkey grid. Both options add deployment, secrets, and CI/CD surface area.
- **Decision:** Run **locally only** for v1. No remote infrastructure. OTel exports to `BUG/<run_id>/trace.jsonl`. No reverse tunnel, no Docker image, no cloud secrets.
- **Why:** While the algorithm and reward heuristic are still being validated, every cloud dollar buys nothing the developer's laptop cannot do. The brief's $23/mo number assumes parallel stochastic monkeys; we run one at a time. Adding infra also delays the first real bug-find by hours of YAML wrangling.
- **Alternatives considered:** Hetzner VPS (rejected — $25-ish/mo for capability we don't yet need), Fargate Spot (rejected — added IAM + ECR + GitHub OIDC config for sporadic runs).
- **Revisit when:** the algorithm has stabilised AND we want to run > 1 monkey/day, OR a teammate needs to trigger runs without local Node setup.
- **Impact:** "Scrapped the cloud version" per user instruction. PROJECT_MAP.md deployment table reads "Local-only — see DECISION_LOG 001".

### 002 — Lightpanda primary, Puppeteer fallback, Windows uses Puppeteer in practice

- **Context:** The brief recommends Lightpanda (Zig-based headless browser, ~16× less RAM than Chromium, designed for AI automation). Lightpanda has Linux x64 and macOS arm64 builds; Windows native is not officially supported as of scaffold time.
- **Decision:** `src/browser/browserFactory.js` implements a strategy pattern that tries Lightpanda first and falls back to Puppeteer on launch failure. `src/browser/lightpanda.js` is a thin stub on Windows — calling it throws `NotImplementedError(decision=002)`. The factory catches that and uses Puppeteer.
- **Why:** Keeps the Lightpanda integration *architecturally complete* so a future Linux deploy needs no code change, while making Windows-local development work today.
- **Alternatives considered:** Lightpanda only (rejected — kills Windows dev), Puppeteer only (rejected — abandons brief's perf gains for Linux deploy), WSL2 Lightpanda (rejected — extra setup for marginal benefit during algorithm validation).
- **Impact:** All browser-touching tests must work against the Puppeteer impl. Lightpanda integration is exercised by structure (factory + stub) only.

### 003 — OpenAI gpt-4o-mini in place of Gemini Flash Lite via OpenRouter

- **Context:** The brief recommends Google Gemini 2.0 Flash Lite via OpenRouter ($0.075 / 1M input tokens, 1M context window). User has an OpenAI key, not OpenRouter.
- **Decision:** Use OpenAI `gpt-4o-mini` ($0.15 / 1M input, $0.60 / 1M output, 128K context). Configurable via `config.yaml` `llm.model` and env-var override.
- **Why:** Same order-of-magnitude cost. 128K context is more than enough for an A11y tree + action history (we use ~2–4K tokens per call). The OpenAI SDK is more mature and Node-friendly.
- **Alternatives considered:** OpenRouter (rejected — user lacks key), local Llama via Ollama (rejected — adds runtime dependency, dilutes "single laptop" footprint).
- **Impact:** `src/llm/openai.js` only. Swapping to Gemini later means one new file (`src/llm/gemini.js`) and a config flag.

### 004 — File-based OTel exporter, no Datadog / Sentry / SigNoz

- **Context:** The brief proposes wiring OTel to Datadog or Sentry to convert stochastic crashes into deterministic bug reports.
- **Decision:** Use a custom file exporter (`src/observability/fileExporter.js`) that writes spans as JSONL to `BUG/<run_id>/trace.jsonl`. No external service. Reproducibility comes from the seeded RNG + the JSONL trace, not from a vendor UI.
- **Why:** Zero external deps, zero monthly cost, zero auth surface. JSONL is grep-able and replayable. A vendor can be added later by swapping the exporter — the SDK and span structure don't change.
- **Alternatives considered:** Datadog (rejected — paid SaaS), Sentry (rejected — overkill for current scale), SigNoz self-hosted (rejected — that's a whole other deployment).
- **Impact:** `src/observability/otel.js` wires the file exporter. Production deploy can add an OTLP exporter alongside without removing the file one.

### 006 — Promote HTTP 503/504 to flag-for-review hard signal

- **Context:** `httpSignals.js` previously only pushed `HTTP_503_504` to `evidence`, never to `out` (the signals array). This meant `scoreState()` received an empty `hardSignals` array on 503/504-only steps and returned `isBug: false, needsReview: false` — the finding evaporated with no artifact written.
- **Decision:** Push `'HTTP_503_504'` to `out` in the `REVIEW_5XX` branch of `pageEventsToHardSignals`, and add `HTTP_503_504: { score: 0.5, severity: 'low', tier: 'flag-for-review' }` to `HARD_SIGNALS` in `expectations.js`. `scoreState()` now returns `needsReview: true` on 503/504, and `writeFlaggedReport()` writes an artifact.
- **Why 503/504 are not auto-assert:** These codes are legitimately ambiguous — 503 covers maintenance windows and rate limiting; 504 covers upstream gateway timeouts. Neither unambiguously indicates an application defect. They must not share the `HTTP_500` auto-assert tier (which fires only on 500/501/502/505+ where no valid non-fault interpretation exists).
- **Why evidence-only was insufficient:** A 503 or 504 triggered by an action the monkey just took is a credible signal worth surfacing. Silently dropping it means a sustained 503 on a critical API path produces zero output, defeating the purpose of the browser-event monitoring layer.
- **What score 0.5 and severity low represent:** Score 0.5 is below every auto-assert signal so a co-firing real signal always wins `highestHardSignal` selection. Severity low reflects that the response may resolve on retry and carries no field-level evidence of data corruption.
- **Downstream impact:** On any step where a 503 or 504 is the only page event, `scoreState()` returns `needsReview: true` and `writeFlaggedReport()` writes a `FLAGGED/` artifact with `tier: flag-for-review, confidence: low`. The run continues; exit code is 0.

### 005 — Vitest unit tests only, no live-browser tests in CI

- **Context:** Puppeteer in CI is famously flaky (Chromium sandbox, network races, font installation). Cypress / Playwright would solve that but add weight.
- **Decision:** vitest unit tests only. Browser-touching code (`src/browser/puppeteer.js`, action handlers) is exercised end-to-end by the live verification run during scaffolding (the bug-hunter subagent), not by CI.
- **Why:** Tests should be fast, stable, and locally green. End-to-end validation belongs in a separate verification step that runs against a real, known-buggy site.
- **Alternatives considered:** Playwright (rejected — adds 250 MB and a fresh test framework), mocked Puppeteer (rejected — mocks for browser tests are notoriously misleading).
- **Impact:** `tests/unit/` covers all pure modules. CI runs `npm test`. Live verification is a one-shot at scaffold time and reruns on demand via `npm start`.

### 013 — Decommission unreliable auto-assert detectors

- **Context:** A reliability audit (code trace + literature + Supabase behaviour) found four wired detectors that auto-assert bugs which are frequently not real on the React/Vite + Supabase (Lovable) target shape.
- **Decision:** Remove `PERF_BREACH` entirely; demote `DOM_FROZEN` and `HTTP_4XX_NAV` from auto-assert to flag-for-review; stop `ASSET_4XX` from firing on benign `REQUEST_FAILED` reasons (`ERR_ABORTED`, `ERR_BLOCKED_BY_*`, transient resets) and filter extension/`ResizeObserver` noise out of `PAGEERROR`.
- **Why:** `PERF_BREACH` is per-action wall-clock latency — environment noise, non-reproducible across machines (the code's own comment conceded this). `DOM_FROZEN`'s fixed-delay empty-DOM check false-fires on slow SPA hydration and legitimately-empty states; a genuine crash-to-blank is already auto-asserted via the co-firing `PAGEERROR`/`CONSOLE_ERROR`, so nothing real is lost. `HTTP_4XX_NAV` is structurally blind to client-routed SPA 404s and the cases it catches (route prefetch, intentional 404 pages) are often correct. `REQUEST_FAILED` mapped every cancellation to an auto-assert `ASSET_4XX` — the dominant false-positive on any data-fetching SPA.
- **Alternatives considered:** Gate `DOM_FROZEN` behind an adaptive mount-node wait + error corroboration (deferred — demotion already captures the value). Origin-gate `HTTP_500`/`PAGEERROR` by allowedDomains (deferred — origin-equality risks false-negatives on Supabase/CDN cross-origin faults; needs suffix matching).
- **Downstream impact:** Auto-assert tier is now `PAGEERROR`, `HTTP_500`, `ASSET_4XX` (genuine asset/hard-failures), `STATE_NOT_DELETED`/`STATE_NOT_PERSISTED`. Everything ambiguous is flag-for-review. Smoke configs route `flaggedRoot` into the smoke dir (also repaired the previously-broken CONSOLE_ERROR smoke). `run.thresholdMs` is now unused and removed from config.

### 014 — PostgREST-correct cross-layer oracle

- **Context:** The cross-layer persisted-state oracle judged presence by HTTP status only. On Supabase/PostgREST (Lovable's default backend) this false-positived on every successful delete and `return=representation` insert, and silently skipped default inserts — three code-traced failures.
- **Decision:** (1) Judge presence by the response body — a PostgREST filter read returns `200 + []` for a gone row and `200 + [{…}]` for a present one, so `isAbsent` treats an empty 2xx array as gone alongside the `goneStatuses` set. (2) Build `?<key>=eq.<id>` verify URLs for created PostgREST rows (detected via the `/rest/v<n>/` mount) instead of an unroutable `/<table>/<id>` path. (3) Extract the created id from the single-row representation array (`[{id}]`).
- **Why:** PostgREST/RLS encode presence/absence in a 200 body (rows vs empty array), never an error; a status-only verdict is structurally blind to it. Same reason a status-only RLS/BOLA detector cannot work.
- **Alternatives considered:** A config flag to force REST style (rejected — auto-detection via the `/rest/v1/` mount covers the dominant Supabase case with no config burden). Content-diff verdict for wrong-value updates (deferred — existence-only still; noted as a known gap).
- **Downstream impact:** The oracle now verifies path-style REST (FastAPI/Express — PetrCollect) and PostgREST (Supabase) correctly. `sharedJarClient` returns null on the Puppeteer fallback arm so the oracle skips rather than crashes. Multi-row and default empty-body inserts remain unverified (no extractable single id) — documented false-negative, not false-positive.

### 015 — Anonymous read-replay authz oracle (flag-for-review)

- **Context:** The dominant vibe-coded-app bug class — missing/broken Supabase RLS exploited via the public anon key (CVE-2025-48757; OWASP API1 BOLA) — had no detector. `CROSS_ACCOUNT_LEAK`/`AUTHZ_UNCERTAIN` were dead rows in the `HARD_SIGNALS` table.
- **Decision:** Wire `src/agent/oracles/authzReplay.js`. After the authenticated crawl, replay the user's GET reads through a fresh isolated (cookie-less) client with the user bearer **stripped** but the public `apikey` **kept**, and flag any read whose owned record id(s) come back unauthenticated. Emits `AUTHZ_UNCERTAIN` (flag-for-review) only.
- **Why flag-for-review, not auto-assert:** passive replay cannot prove the data is private vs. intentionally public — identical bytes either way; Autorize and BOLABuster both keep a human in the loop. Identity-grounding (same-owned-id overlap) keeps it low-noise; capability/signed URLs, a public allowlist, missing-bearer, and non-id bodies are all skipped so it never fires on by-design public access.
- **Alternatives considered:** Status-only "anon got 200" verdict (rejected — Supabase returns 200 for public, RLS-off, and filtered-empty alike; would hallucinate). Auto-assert `CROSS_ACCOUNT_LEAK` (deferred — needs identity PROOF via seed-a-marker-as-A or a distinct peer account B).
- **Downstream impact:** New `oracle.authzReplay` config block; runs once per run after the arms, bounded by `maxReplays`, wrapped so it never crashes a run. Cookie-auth reads are out of scope (captured headers don't expose the cookie credential) — header/bearer auth (Supabase) is covered, which is the target. Next: seed-and-detect or a peer-account arm to promote confirmed leaks to the auto-assert `CROSS_ACCOUNT_LEAK` tier.

### 016 — Heuristic seeded form-filler (FORM_FILL action)

- **Context:** The write-dependent oracles (`STATE_*`, authz replay) only fire after a successful backend write, but random single-field input rarely submits a VALID form (the documented "30% curse" / UI-tarpit) — so those oracles sat idle on real apps. This is the reachability gap.
- **Decision:** Add a `FORM_FILL` action that fills every field of a form with type-appropriate VALID data and submits. Pure seeded planner (`actions/formPlan.js`) maps field type/name/label/constraints → valid values (email, policy password with confirm-matching, phone, number-in-range, a real `<select>` option, consent checkboxes, one radio per group); DOM layer (`perception/forms.js`) tags fields and writes values via the native value setter + bubbled input/change events (React/Vue/Svelte-compatible) then submits.
- **Why heuristic, not LLM:** the reproducibility contract requires seeded determinism (DECISION_LOG 012 removed the LLM from the hot loop for exactly this). Heuristics cover the standard forms vibe-coded apps ship, are free/fast/debuggable, and stay seed-stable. An LLM fallback (cached by form-signature so it remains reproducible) is deferred until real-app submit rates show heuristics plateau.
- **Alternatives considered:** LLM-per-form (rejected — breaks reproducibility, adds cost/latency). React `setNativeValue` in-page vs per-engine typing APIs (chose native-setter-in-evaluate — one path works on both Playwright and Puppeteer). Adversarial payloads inside FORM_FILL (rejected — would fail validation; XSS/SQLi stays in the single-field INPUT action).
- **Downstream impact:** New `FORM_FILL` weight (0.25). Real `<form>`s preferred; the body is a synthetic fallback (may lump unrelated inputs — documented). Arbitrary `pattern` generation, cross-field semantics beyond confirm-match, and multi-step wizards are not handled. Validated end-to-end on a real browser by `tests/smoke/formfill.mjs` (`npm run smoke:forms`).
