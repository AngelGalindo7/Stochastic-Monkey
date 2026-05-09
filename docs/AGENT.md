# Agent — MCTS, State Abstraction, Failed Expectations

## `src/agent/mcts.js`

Standard four-step MCTS loop driven by UCB1.

```
function step(rootContext):
    leaf      = select(root)              # UCB1 down-tree
    child     = expand(leaf)               # one untried action
    reward    = simulate(child)            # rollout (in our case = single LLM-evaluated action)
    backprop(child, reward)                # add reward up the parent chain
```

`select` picks the child maximizing `Q(s,a)/N(s,a) + c * sqrt(ln N(s) / N(s,a))`. `c = config.mcts.ucbC` (default 1.4). Untried children always preferred (Inf UCB).

`simulate` is shallow on purpose. The brief's "rollout" is: take *one* action, score it via `expectations.surprise()`, treat that as the leaf reward. Deep rollouts on a real browser are too expensive (each step is a real DOM interaction). Effectively the algorithm is **best-first tree search with UCB exploration** — still benefits from MCTS structure but doesn't simulate forward.

`backprop` walks parent pointers, incrementing `visits` and adding `reward` to `totalReward`.

## `src/agent/stateAbstraction.js`

Single function: `clusterId(a11yTree) → string`.

Steps:
1. Walk the tree, collect interactive nodes (role ∈ {button, link, textbox, checkbox, ...}).
2. For each node, normalize the accessible name: strip numeric runs, UUIDs, hashes, currency amounts.
3. Drop layout-only roles.
4. Sort siblings by normalized role + name to make order-independent.
5. `md5(JSON.stringify(normalized)).slice(0, 12)`.

Tested in `tests/unit/stateAbstraction.test.js` with two near-equal trees that should collide and one structurally different tree that should not.

## `src/agent/expectations.js`

```
predict(a11ySnapshot, proposedAction) → predictionString
  ↓ LLM call (gpt-4o-mini, ~150 tokens)
surprise(prediction, observedSnapshot, pageEvents) → score ∈ [0, 1]
  ↓ if pageEvents has any hard signal → return 1.0 (override)
  ↓ else compute A11y diff size + LLM-judged divergence → 0..1
```

The "hard signal override" is the main reliability mechanism. Without it, the LLM's prediction and the LLM's surprise scoring would drift toward each other (both trained to be plausible) and the agent would never trigger high reward on real bugs. Concrete hard signals:

| Event | Severity | Surprise |
|---|---|---|
| `pageerror` (uncaught JS exception) | high | 1.0 |
| HTTP 5xx response | critical | 1.0 |
| Image / asset 4xx | medium | 0.9 |
| Latency above `run.thresholdMs` | low | 0.6 |
| DOM frozen for > 3 staleness checks | medium | 0.85 |

## `src/agent/policy.js`

Two responsibilities:

1. **Filter:** drop elements matching any `target.blockedSelectors`. Hard guard, no soft weight.
2. **Select:** weight remaining candidates by `config.actions.weights[ACTION_TYPE]`, then break ties by UCB1 from the MCTS node.

Returns `{ actionType, target, prior }`.

## Why this is "MCTS-shaped" but cheaper than canonical MCTS

Canonical MCTS does deep random rollouts and accumulates rewards along the path. We can't — every "step" is a real browser click that takes 100–500 ms. Instead:

- **Tree depth = pages explored.** Each browser action is one tree step.
- **Rollouts = single-action reward via LLM surprise.** No forward simulation.
- **Backprop is still useful.** It biases `select` toward sub-trees that have produced surprising states in the past.

This matches what the brief calls "MCTS as test-time online planning" rather than "AlphaGo MCTS with deep rollouts."
