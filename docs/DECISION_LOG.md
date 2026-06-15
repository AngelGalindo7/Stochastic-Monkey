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
