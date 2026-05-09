2# How Heuristic Monkey works (plain-English version)

If you've never set up YAML test configs or thought about "expectations" before, start here. This document walks through one full agent step in narrative form so the rest of the docs make sense.

## The core idea in one sentence

The agent does random things on your website, asks an LLM "what *should* happen if I click this?" before each action, then rewards itself when reality doesn't match the prediction — because *that's where bugs live*.

## The loop, step by step

Imagine the agent just landed on `https://your-site.com/checkout`.

### 1. Look at the page (perception)

The agent doesn't read raw HTML — that's noisy and expensive. It reads the **accessibility tree**: the same data screen-readers use. It looks roughly like:

```json
{
  "role": "main",
  "children": [
    { "role": "textbox", "name": "Card number" },
    { "role": "textbox", "name": "Expiry" },
    { "role": "button", "name": "Pay $42.00" }
  ]
}
```

Every interactive thing is in there — buttons, inputs, links. Layout containers are dropped. This is roughly 1/100th the size of raw HTML, which keeps LLM token costs low.

### 2. Figure out what's possible (policy)

From the tree the agent builds a list of candidate actions:

- `CLICK` on "Pay $42.00"
- `INPUT` into "Card number"
- `INPUT` into "Expiry"
- `SCROLL`
- `REFRESH`
- `BACK`

Each candidate has a *prior* — its weight from `config.yaml`. CLICKing is more likely than SCROLLing because we set `CLICK: 0.4` and `SCROLL: 0.1`.

**Crucially, blocked selectors get filtered out here.** If your YAML has `blockedSelectors: ["a[href$='/logout']"]`, the agent never sees the logout link as a candidate. This is your kill-switch for destructive actions.

### 3. Pick one (MCTS + UCB1)

The agent maintains a tree of every state it has seen and what reward each branch produced. It uses **UCB1** — a math formula from multi-armed bandits — to balance:

- *Exploit:* "I've found surprising stuff in this branch before, do more of it"
- *Explore:* "I haven't tried this branch much, let me try something new"

If we're in a brand-new state, all candidates have equal exploration value, so the priors decide. If we've been here before, the formula prefers the branch that has produced higher surprise scores per visit.

### 4. Predict what should happen (the LLM)

Before clicking, the agent asks the LLM something like:

> Tree: [pruned A11y JSON above]
> Action: CLICK on { role: "button", name: "Pay $42.00" }
> Predict in one sentence what should happen.

The LLM replies, e.g.:

> "Submitting the form will validate the card and load the order confirmation page."

This *prediction string* is the agent's "expectation."

### 5. Do the thing (action)

The agent runs the actual click via Puppeteer. The page changes, network requests fire, maybe a JavaScript error pops, maybe a 500 response comes back.

### 6. Observe (perception again)

The agent grabs a fresh A11y snapshot. It also collects every page-level event that fired during the action: console errors, uncaught exceptions, HTTP responses, failed requests.

### 7. Score the surprise (the reward)

This is the heuristic that makes the whole thing work.

- **If a hard signal fired** (uncaught JS exception, HTTP 5xx, image 404), the surprise score is forced to 1.0 with severity `high` or `critical`. We don't even ask the LLM. Hard signals are objective bugs.
- **Otherwise**, the agent asks the LLM:

> Prediction: "Submitting will validate and load the confirmation page."
> Observed: [new A11y tree, truncated]
> Page signals: []
> Score 0..1 how surprising. Reply JSON.

The LLM answers, e.g. `{"score": 0.2, "reason": "form was replaced by confirmation, matches prediction"}` (low surprise, no bug) or `{"score": 0.85, "reason": "page is unchanged, no confirmation appeared"}` (high surprise — likely a silent failure).

### 8. Backpropagate (MCTS)

The score is added to every node from the chosen leaf back up to the root. This biases future MCTS selections toward branches that have been surprising in the past — exactly the branches most likely to be near bugs.

### 9. If surprise ≥ 0.85 → write a bug report

When score crosses the threshold (or any hard signal fires), triage runs:

- Take a screenshot
- Save the full DOM
- Save all breadcrumbs (the action log)
- Save the OTel trace (every span — LLM calls, action timings, page events)
- Render `bug.md` with the URL, severity, signal type, and reproduction steps
- Write `repro.js` — a Node script that reruns the same seed → same actions → same bug

All of that lands in `BUG/<iso-timestamp>__seed<N>__<severity>/`.

## What the YAML config actually does

Read every value as: "this knob biases the agent toward (or away from) some kind of behavior."

| YAML key | What it controls |
|---|---|
| `target.url` | Where the agent starts |
| `target.allowedDomains` | Hard guard. The agent will NEVER navigate off these domains. |
| `target.blockedSelectors` | Hard guard. The agent will NEVER click these. (Logout, delete, etc.) |
| `run.seed` | The random seed. **Same seed = same run.** Critical for reproducibility. |
| `run.maxSteps` | Stops the run after N actions even if no bug found. |
| `run.thresholdMs` | Latency above this fires a low-severity hard signal. |
| `actions.weights` | Priors over action types. Lower CLICK and raise INPUT to test forms more. |
| `actions.dataPool` | Strings the agent types into INPUT fields. Add adversarial values to fuzz. |
| `macros.fireProbability` | How often the agent runs a multi-step flow instead of a single action. |
| `macros.list` | Predefined sequences (e.g., login + back + relogin) — the bugs that only appear in *flows*. |
| `mcts.ucbC` | Higher = more random exploration; lower = more exploitation of known-bad branches. |
| `mcts.abstractionGranularity` | Coarser = smaller MCTS tree, fewer distinctions; finer = bigger tree, more memory. |
| `llm.enabled` | Toggle the LLM. With it off, the agent runs on hard signals only — still finds real bugs, just dumber. |

## Why predictions help even when the LLM is wrong

You might worry the LLM is fallible — if it predicts the wrong outcome, the agent thinks there's a bug when there isn't. Two things mitigate this:

1. **Hard signals override LLM scoring.** A real bug — JS exception, 500 response, broken image — wins regardless of what the LLM thought.
2. **MCTS averages out noise.** A single noisy reward doesn't dominate the tree. The bias toward bug-prone branches only emerges if multiple rollouts agree.

The LLM's job isn't to be a perfect oracle. It's to inject **a non-trivial prior on what 'normal' looks like**, so the agent's "boring" reward isn't 0 everywhere and "surprising" reward emerges from real divergence rather than just from page diffs.

## Where macros come in

A pure single-action loop misses **stateful** bugs:

- "Submit form, hit back, submit again — second submit hangs."
- "Add to cart, click another product, click back — cart shows wrong item."
- "Refresh during loading state — UI freezes."

Define these as macros in `config.yaml`. The agent fires them with `macros.fireProbability` chance per step. Each macro is one MCTS step but multiple browser actions. If surprise crosses threshold *during or after* the macro, the bug report captures the whole sequence in breadcrumbs.

## What this isn't

- Not a replacement for written test cases. Those still test critical user flows deterministically.
- Not a security scanner. There's no payload library, no auth bypass logic, no SSRF probing.
- Not a full DRL agent. We use MCTS as a planner, not as a learned policy. No training, no GPUs.
