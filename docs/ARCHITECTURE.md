# Architecture

## End-to-end flow

```
┌────────────┐
│ config.yaml│  ─►  config/loader  ─►  RunContext { seed, target, weights, mctsParams, llm, otel }
└────────────┘                                  │
                                                ▼
                                    ┌─────────────────────┐
                                    │  observability/otel │  spans → fileExporter → BUG/<run_id>/trace.jsonl
                                    └─────────────────────┘
                                                │
                                                ▼
                                    ┌─────────────────────┐
                                    │ browser/Factory     │  Lightpanda? → fallback → Puppeteer
                                    └─────────────────────┘
                                                │
                                                ▼
                            ┌─────────────────────────────────────┐
                            │  agent/mcts loop (until maxSteps)   │
                            │   1. perception/a11yTree.snapshot   │
                            │   2. perception/domHash → stateId   │
                            │   3. agent/stateAbstraction → cluster│
                            │   4. policy.select(node, weights)   │
                            │   5. expectations.predict(LLM)       │
                            │   6. actions.run                    │
                            │   7. expectations.surprise(observed)│
                            │   8. mcts.backprop(reward)           │
                            └─────────────────────────────────────┘
                                                │
                                                ▼
                            ┌─────────────────────────────────────┐
                            │  on terminal failure or end-of-run  │
                            │  triage.write(BUG/<iso>__seed__sev/)│
                            └─────────────────────────────────────┘
```

## Why MCTS (vs DRL or pure random)

DRL needs thousands of GPU-hours to learn a single site. Pure weighted random (the original `Stochastic-Monkey/engine.js`) explores broadly but does not concentrate effort on broken states. MCTS gets you online planning at test time: every rollout that hits a "surprising" state increases the visit count and reward of that branch, so subsequent rollouts pile in to map the full extent of the bug. Combined with state abstraction, the tree stays small enough to fit in RAM.

## Why "failed expectations" as the reward

The brief's central insight: bugs are not detectable by ground truth (the agent doesn't know what's correct), but they are detectable as **divergence from a plausible-action prediction**. When the LLM says "clicking Submit will load the confirmation page" and instead the page silently 500s, the divergence is the bug signal. Hard signals (`pageerror`, HTTP 5xx, image 404) override LLM scoring to 1.0 because they're objectively-bad regardless of what the LLM expected.

## State abstraction

A11y trees from real apps explode the MCTS tree. Two product cards differing only by ID would be two distinct states. We hash a *normalized* subtree:

- Strip numeric runs from accessible names (`Order #4827` → `Order #N`)
- Strip UUID-shaped strings
- Drop layout-only roles (`generic`, `none`)
- Drop attributes Chromium adds for layout (`bounds`, `nodeId`)

Then `md5(JSON.stringify(normalized))` becomes the cluster ID. Empirically this collapses 1000+ raw states to ~30–80 clusters per page — the brief's claimed 10× reduction.

## OTel layout

Every action emits a span:

| Span name | Attributes |
|---|---|
| `mcts.expand` | `step`, `state_id`, `parent_state_id`, `untried_action_count` |
| `mcts.select` | `step`, `state_id`, `chosen_action`, `ucb_value` |
| `action.click` / `action.input` / `action.navigate` / `action.scroll` | `step`, `target_selector`, `latency_ms` |
| `llm.predict` | `step`, `model`, `prompt_tokens`, `response` |
| `expectations.surprise` | `step`, `score`, `hard_signal_override`, `signal_type` |
| `page.event.<console_error / pageerror / requestfailed / response_4xx / response_5xx>` | `step`, `url`, `status_or_message` |

All spans share `run_id`. JSONL exporter writes one span per line. Replaying = grep on `run_id`.

## Reproducibility contract

- `config.run.seed` controls every `seedrandom` call. Same seed + same target = same action sequence.
- `RUN_ID = sha1(seed + iso8601_to_second).slice(0,8)` ties one execution to its bug folder.
- `repro.js` written into the bug folder hard-codes the seed, target URL, and config snapshot. `node repro.js` re-executes the same run.
