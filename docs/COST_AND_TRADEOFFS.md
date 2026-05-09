# Cost, tradeoffs, and ways to do this differently

## Money

| Item | Cost | Notes |
|---|---|---|
| Hardware | $0 | Local dev box. No VPS, no Fargate. |
| Chromium | $0 | Puppeteer downloads it; 200 MB on disk. |
| OpenAI gpt-4o-mini | ~$0.0005–$0.002 per run | 30 steps × 2 LLM calls × ~500 tokens = ~30K tokens. At $0.15/$0.60 per 1M, that's $0.005 input + $0.018 output ≈ **2 cents per run**. |
| OTel + storage | $0 | Local JSONL files. |
| GitHub issue API | $0 | Free tier covers issue creation. |

**Per-run dollar cost: ~$0.02 with LLM, $0 without.** Run it 100 times a day for a month, that's $60.

If you upgrade to `gpt-4o` for accuracy: ~10× cost → ~20¢ per run. Still nothing.

If you go to Hetzner ($23/mo VPS) plus parallel monkeys, you've added compute cost but the *unit* cost per run drops because the LLM amortizes across many seeds. See DECISION_LOG 001 for why we deferred.

## Compute

| Component | Local cost |
|---|---|
| Chromium per run | ~500 MB RAM, brief CPU spike on launch |
| Vitest suite | <1 s, <100 MB RAM |
| OTel SDK overhead | negligible (<1% of run time) |
| One LLM round-trip | 200–800 ms |
| One MCTS step (incl. browser action + 2 LLM calls) | 1–2 s |
| 30-step run | ~30–60 s |

A laptop can comfortably run one monkey at a time. 4 in parallel works on 16 GB RAM. 10+ wants a Hetzner box.

## Major design tradeoffs

### MCTS vs DRL

- **MCTS (chosen)**: zero training, zero GPU, simple math, online planning. Doesn't *learn* across runs — every run is a fresh tree. But: easy to debug, easy to tune, no model artifacts to ship.
- **DRL alternative**: train a policy network on past runs to bias action selection. Faster bug-find on familiar sites, but needs training infrastructure, data labeling, and model versioning. Worth it once you've stabilised the algorithm and want to compound learnings across thousands of runs — not for v1.

### LLM evaluation vs heuristic-only

- **LLM-evaluated surprise (chosen)**: catches divergence the agent couldn't have predicted with rules. Costs cents per run.
- **Pure-heuristic alternative**: hard signals only — pageerror, 5xx, 4xx, perf threshold. Free, faster, less smart. Misses silent regressions (page didn't error but also didn't change when it should have). **The agent already supports this** — flip `llm.enabled: false` in YAML.

### Puppeteer vs Lightpanda vs Playwright

- **Puppeteer (chosen)**: stable, Windows/Mac/Linux, full Chrome semantics. ~500 MB RAM per instance. Industry standard.
- **Lightpanda**: 16× lighter (123 MB for 25 parallel browsers!). Zig-based. **No Windows binary**, JS support still maturing. Architectural fit for the brief, deferred to Linux. Stub is in place.
- **Playwright**: multi-browser (Firefox, WebKit) and richer auto-wait. Adds 250 MB and a fresh API surface. Worth it only if cross-browser bug coverage is a stated goal.

### A11y tree vs raw DOM vs vision

- **A11y tree (chosen)**: ~1/100th the tokens of raw HTML. Captures everything semantically interactive. Doesn't capture visual bugs (overlapping elements, color contrast, off-screen flicker).
- **Raw DOM**: every detail, but token-prohibitive for LLM eval (100K+ tokens / page).
- **Vision-LLM (e.g. GPT-4o vision on screenshots)**: catches visual bugs the A11y tree misses. ~5–10× the cost per call. Could augment, not replace.

### File-based OTel vs Datadog/Sentry

- **File-based JSONL (chosen)**: $0/mo, grep-able, replayable. Replay = "load JSONL, assert sequence."
- **Datadog/Sentry**: nice UI, alerting, retention. ~$15+/mo minimum. Worth it once multiple devs trigger runs and want shared dashboards.

### Single-agent vs swarm

- **Single agent (chosen)**: easy to reason about, deterministic with a seed.
- **Swarm**: N agents with different seeds in parallel. Higher coverage in fixed wall-clock time. Hetzner VPS makes this cheap. Adds orchestration code (process pool, result aggregation). Defer until v1 has stabilised.

## Where the design is weakest (and how to fix)

### 1. Action targeting is name-based, not selector-based

`runClick` finds elements by their *visible text* via XPath. Two buttons with the same label collide. **Fix:** track a stable selector path (CSS or full A11y path) per node and use that. Adds ~50 LoC but removes a class of action failures.

### 2. State abstraction can over-collapse

If two pages have the same A11y subtree at the chosen depth, they hash to the same MCTS state. The tree thinks it has been somewhere it hasn't. **Fix:** include the URL hash in the cluster ID, or detect URL changes and treat them as forced new states. ~20 LoC.

### 3. The LLM never sees recent action history

Each `predict` call is stateless — the LLM doesn't know what happened on the previous 5 steps. It might predict a "go back" outcome assuming the user was on the homepage. **Fix:** include the last 3–5 breadcrumbs in the prompt. Costs ~200 more tokens per call (~10% more $). Probably worth it.

### 4. No cookie / auth injection

The agent always starts logged-out. Authenticated bugs are invisible. **Fix:** add `auth: { cookies: [...] }` to YAML. `puppeteer.js` calls `page.setCookie()` after launch, before `goto`. ~30 LoC.

### 5. Macros are static — no learned macros

Macros are hand-written. The agent could *learn* sequences that have produced bugs in past runs. **Fix:** persist surprising N-grams of actions across runs (e.g. SQLite). Promote them to macros automatically when they reproduce. Significant work — v2 territory.

### 6. No screenshots between actions

Only the bug screenshot is saved. A timeline of screenshots would make bug.md vastly more useful for human reviewers. **Fix:** snapshot every step into `BUG/<run_id>/steps/<n>.png`. Adds ~10 MB per run; trivial code.

### 7. Vision-LLM augmentation

The biggest accuracy lever after macros: feed the screenshot AND the A11y tree to GPT-4o vision. Catches visual regressions the A11y tree can't see (overlap, off-screen elements, color/contrast). 5–10× the LLM cost. Probably worth it for high-value runs (pre-release, prod-canary).

### 8. Better surprise reward shaping

Right now surprise = LLM 0..1 OR a hard-signal bucket. The score doesn't distinguish "predicted X, got X+Y (extra unexpected element)" from "predicted X, got Z (totally diverged)." A signed embedding distance between predicted-tree and observed-tree could give richer reward gradients. ~100 LoC + an embeddings dependency.

## When to switch to something else

- Need cross-browser coverage → swap Puppeteer for Playwright.
- Running > 10 parallel monkeys → move to Hetzner / Fargate.
- Need historical analytics → add Datadog or SigNoz alongside the file exporter.
- Have a model team → replace LLM-eval with a fine-tuned small classifier for surprise (cheaper, faster, more deterministic).
- Truly massive site (100K+ pages) → DRL with MCTS as warm-start.

## What I'd build next, in priority order

1. **Multi-step screenshot timeline** in BUG/ — biggest UX win, smallest code.
2. **Action-history-aware predictions** — biggest accuracy win for ~$0 extra.
3. **Auth cookie injection** — unlocks the 80% of any real app that lives behind login.
4. **URL-aware state abstraction** — fixes silent over-collapse.
5. **Vision-LLM augmentation** — catches the visual class of bugs.
6. **Persistent learned macros** — compounds value across runs.
7. **Parallel orchestrator** — once #1–#6 are stable.
