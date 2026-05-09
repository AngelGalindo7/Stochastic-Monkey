# Heuristic Monkey — Project Map

> Always-loaded session reference. For deep detail see `docs/` per area.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ · ESM |
| Browser | Puppeteer (Chromium) primary on Windows · Lightpanda primary on Linux (when available) |
| Algorithm | Monte Carlo Tree Search (UCB1) + state abstraction over A11y subtrees |
| Reward | "Failed expectations" — LLM-predicted outcome vs. observed surprise |
| LLM | OpenAI `gpt-4o-mini` (configurable). Stubs deterministically when no key. |
| Observability | OpenTelemetry SDK (Node) → JSONL file exporter (no external vendor) |
| Config | YAML (`config.yaml`) · env-var overrides via dotenv |
| Tests | vitest (unit only — browser-touching code is exercised by the live verification run) |

## Deployment & Infrastructure

| Aspect | Status |
|---|---|
| Runtime location | **Local-only.** See `docs/DECISION_LOG.md` entry **001** for Hetzner / AWS Fargate deferral. |
| Cost target | **$0/month** while algorithm is being validated. Only OpenAI usage is variable (cents per run). |
| Browser binary | Puppeteer downloads its own Chromium on `npm install`. No system Chrome required. |
| Persistence | Bug artifacts live in `BUG/<run_id>/` on local disk. No DB. |

---

```
heuristic-monkey/
├── CLAUDE.md                Mentor / commit / briefings rules
├── PROJECT_MAP.md           This file
├── README.md                Quickstart for humans
├── package.json
├── vitest.config.js
├── config.yaml              "White-glove" run config
├── .env.example             OPENAI_API_KEY etc.
├── docs/                    Detail files (see below)
├── src/                     All runtime code
├── tests/                   vitest unit suite + A11y fixtures
├── BUG/                     Generated bug artifacts (gitignored)
└── .github/workflows/       CI — npm test on pushes
```

## Key Entry Points

| File | Role |
|---|---|
| [src/index.js](src/index.js) | CLI entry. Loads `config.yaml`, builds browser via factory, runs MCTS until `maxSteps` or terminal failure. On failure → `triage.write(BUG/...)`. |
| [src/agent/mcts.js](src/agent/mcts.js) | UCB1 selection / expansion / simulation / backprop. Reward source = `expectations.surprise()`. |
| [src/agent/stateAbstraction.js](src/agent/stateAbstraction.js) | Hashes a normalized A11y subtree → cluster ID. Bounds tree size. |
| [src/agent/expectations.js](src/agent/expectations.js) | Pre-action LLM prediction; post-action surprise scoring. Hard signals override to 1.0. |
| [src/browser/browserFactory.js](src/browser/browserFactory.js) | Strategy: try Lightpanda; fall back to Puppeteer. On Windows always falls back. |
| [src/perception/a11yTree.js](src/perception/a11yTree.js) | Pulls `page.accessibility.snapshot()`, prunes layout-only nodes, returns token-cheap JSON. |
| [src/observability/otel.js](src/observability/otel.js) | OTel SDK setup + file-based span exporter. Spans for MCTS expansion, action exec, LLM call, page event. |
| [src/triage/triage.js](src/triage/triage.js) | Writes `BUG/<iso>__seed<n>__<severity>/` with screenshot, dom snapshot, breadcrumbs, trace, repro. |
| [config.yaml](config.yaml) | Target URL, allowed domains, blocked selectors, action weights, MCTS hyperparameters, LLM toggle. |

## Service Communication

```
CLI (src/index.js)
  ├──► browserFactory ──► [Lightpanda? → fallback] ──► Puppeteer/Chromium ──► Target site
  ├──► perception/a11yTree ──◄ page.accessibility.snapshot()
  ├──► agent/mcts ──► agent/policy ──► action handler ──► page.click/type/...
  ├──► agent/expectations ──► llm/openai ──► OpenAI API
  ├──► observability/otel ──► fileExporter ──► BUG/<run_id>/trace.jsonl
  └──► triage/triage ──► BUG/<iso>__seed<n>__<severity>/{screenshot,dom,breadcrumbs,bug.md,repro.js}
```

## Detail Files

Load only what the current task needs.

| Working on | Read |
|---|---|
| MCTS, state abstraction, surprise scoring | `docs/AGENT.md` |
| Browser launch / Puppeteer / Lightpanda fallback | `docs/BROWSER.md` |
| OTel spans / file exporter / breadcrumbs | `docs/OBSERVABILITY.md` |
| End-to-end design overview | `docs/ARCHITECTURE.md` |
| Architectural decisions / scope deferrals | `docs/DECISION_LOG.md` |
| Bug-fix history | `docs/BUG_FIX_LOG.md` |

## Critical Gotchas

- **Lightpanda Windows gap.** Lightpanda has no native Windows binary as of scaffold time. `browserFactory.js` always falls back to Puppeteer on `process.platform === 'win32'`. See `DECISION_LOG.md` entry **002**.
- **OpenAI key optional.** `src/llm/openai.js` reads `OPENAI_API_KEY`. If unset, the LLM call returns a deterministic stub prediction and logs once. Surprise scoring then collapses to "hard signals only" mode (JS exception / 5xx / image 404). See `DECISION_LOG.md` entry **003**.
- **Hard signals always win.** Even when LLM-based surprise returns ~0, a `pageerror`, HTTP 5xx, or asset 4xx forces surprise to 1.0. This is what makes the agent reliably hunt bugs rather than chase prediction errors.
- **Run ID is deterministic per seed.** `run_id = sha1(seed + isoStartTimestampSecond).slice(0,8)`. The `repro.js` artifact rebuilds the same run when re-executed within the same second; otherwise the seed alone is the canonical reproducer.
- **OTel exporter writes JSONL, not OTLP.** `src/observability/fileExporter.js` is custom — do not swap in `@opentelemetry/exporter-trace-otlp-http` without a Datadog/Sentry/SigNoz endpoint configured. See `DECISION_LOG.md` entry **004**.
- **Forbidden selectors are hard guards.** `policy.js` filters elements matching any `target.blockedSelectors` *before* sampling. There is no "soft" weight on these — they are skipped entirely.
- **State abstraction throws away IDs and digits.** Two product cards differing only by ID hash to the same cluster. This is the brief's 10× tree-size reduction. If you need to distinguish them later, hash the full unnormalized tree separately for triage breadcrumbs.
- **Triage folder name is the source of truth.** Format: `BUG/<iso8601>__seed<n>__<severity>/`. Tests assert this exact shape. Don't rename it without updating `tests/unit/triage.test.js` and the `repro.js` template in the same commit.
- **`.env` contains real credentials.** Never committed (in `.gitignore`). Copy from `.env.example` for local runs.
- **Step screenshots live next to the trace, not in the bug folder.** Every action produces `BUG/<run_id>/steps/<step>.png`. The bug folder's `bug.md` references the path. Don't move them — `repro.js` and OTel spans both reference the run-id-keyed location.
- **Auth cookies are applied before `goto`.** `config.auth.cookies` is set on the page right after launch. Cookies must specify either `domain` or `url`. Schema validates required fields.
- **LLM predictions see the last 5 action breadcrumbs.** Prompts include recent action history so divergence scoring isn't blind to the prior 5 steps. Costs ~10% more tokens per call.
