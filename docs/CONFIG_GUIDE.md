# config.yaml — field-by-field

Every field, what it does, what to tune it to, what changing it costs.

## `target` block

### `target.url`
Starting URL. The agent loads this first. If you want to test only an authenticated area, you'd inject session cookies before launching (not yet supported in v1 — see "Improvements" in `docs/COST_AND_TRADEOFFS.md`).

### `target.allowedDomains`
Array of hostnames. The agent **will not navigate** to any URL whose hostname doesn't end in one of these. Hard guard — there's no soft weight.

```yaml
allowedDomains:
  - my-staging-site.com
  - cdn.my-staging-site.com   # if you have asset subdomains
```

### `target.blockedSelectors`
Array of CSS-selector-shaped strings. The agent's policy filter checks the *accessible name* of every candidate element against substrings in these patterns: `logout`, `delete`, `destructive`. (We don't run a full CSS-selector engine on the A11y tree — that's a v2 improvement.) Add elements you don't want clicked under any circumstance:

```yaml
blockedSelectors:
  - "a[href$='/logout']"        # matches any link named "Logout"
  - "form[action*='delete']"    # matches any "Delete" / "Remove" button
  - "[data-destructive='true']" # matches anything where `node.destructive` is true (you'd set this in your test harness)
```

### `target.fallbackUrls`
Used by the bug-hunter subagent only. If the primary URL doesn't surface a bug after `run.maxSteps`, the next run starts here.

## `run` block

### `run.seed`
Number. Drives every random choice. **Same seed + same target = same actions in the same order**. This is how `repro.js` works.

### `run.maxSteps`
Hard cap on actions. The run ends after N steps even if nothing has been surprising. Tune up if your site is slow to surface bugs; tune down if you're iterating quickly.

### `run.humanDelayMs`
Pause after each action. Two reasons:
1. Real bugs often need time to render — race conditions, debounced state.
2. Some sites rate-limit fast clicks.

### `run.thresholdMs`
Latency above this counts as a `PERF_BREACH` hard signal (low severity). Default 3000 (3 s).

### `run.stopOnFirstBug`
`true` — stop at the first crossed threshold. Good for quick iteration.
`false` — keep hunting. Useful if you want a list of bugs in one run.

## `actions` block

### `actions.weights`
Priors over action types. Higher = more likely to be picked at any given step.

```yaml
weights:
  CLICK: 0.40       # interactive buttons / links
  INPUT: 0.15       # type into form fields
  NAVIGATION: 0.10  # follow an internal link to another page
  SCROLL: 0.10      # virtual list / lazy-load triggers
  BACK: 0.10        # browser history backward
  FORWARD: 0.05     # browser history forward
  REFRESH: 0.10     # full page reload
```

Tuning hints:
- Heavy-form site → bump INPUT to 0.3.
- SPA where most state lives in routing → bump NAVIGATION + REFRESH.
- Long pages with infinite scroll → bump SCROLL.
- Suspect bugs after navigation history? Bump BACK + FORWARD.

### `actions.dataPool`
Strings to type into input fields. Mix:
- Benign data (`test_user`, `12345`, valid email).
- Adversarial data (`<script>alert(1)</script>`, `' OR 1=1 --`, very long strings, unicode bombs).

The mix matters: too benign and you miss validation bugs; too adversarial and you'll never get past form validation to find downstream bugs.

## `macros` block — the underrated lever

A "macro" is a fixed multi-step sequence that runs as one MCTS step.

### Why?
Single-action sampling can never find:
- "Submit form → click Back → form is in a broken state."
- "Add item → refresh → cart is empty but the badge still says 1."
- "Type into search → press Esc → search box loses focus but UI still shows results."

These are *stateful* bugs. They require an exact sequence.

### `macros.fireProbability`
Number 0..1. Chance that *this step* uses a macro instead of a single action. 0.15 is a good default.

### `macros.list`
Array of macro objects. Each has:
- `name`: free-form label, shows up in breadcrumbs.
- `weight`: relative likelihood vs other macros (default 1).
- `steps`: ordered array. Each step has:
  - `type`: `CLICK | INPUT | NAVIGATION | SCROLL | BACK | FORWARD | REFRESH`.
  - `target`: optional. The accessible name to match (e.g. `"Submit"`).
  - `value`: optional. For INPUT, the string to type.
  - `required`: optional. Default true. If false, the macro continues even if this step doesn't match anything.
  - `delayMs`: optional. Pause after this step.

### Example: a real-world login-then-break sequence

```yaml
- name: login_then_back
  weight: 2
  steps:
    - { type: INPUT, target: "username", value: "valid_user" }
    - { type: INPUT, target: "password", value: "valid_pw" }
    - { type: CLICK, target: "Sign in" }
    - { type: BACK, delayMs: 600 }      # browser back after successful login
    - { type: REFRESH }                  # refresh on the prior page
    - { type: FORWARD }                  # then forward to the dashboard
```

Catches: stale session token, broken back-button caching, post-login race conditions.

### Example: cart manipulation

```yaml
- name: add_remove_refresh
  weight: 1
  steps:
    - { type: CLICK, target: "Add to cart", required: false }
    - { type: NAVIGATION, required: false }
    - { type: REFRESH }
    - { type: BACK }
    - { type: REFRESH }
```

## `mcts` block

### `mcts.ucbC`
Exploration constant in the UCB1 formula. Default 1.4 (the standard MCTS value).

- Lower (0.5–1.0): more exploitation. Once you find a buggy branch, you'll dig deep.
- Higher (2.0+): more exploration. Better coverage, slower bug confirmation.

### `mcts.abstractionGranularity`
Controls how aggressively the agent treats different states as "the same":

| Value | A11y subtree depth | Tree size | When |
|---|---|---|---|
| `coarse` | 2 | smallest | Large, repetitive UIs (e-commerce listing pages) |
| `medium` | 4 | balanced (default) | Most apps |
| `fine` | 8 | largest | Small, deep, distinct states (multi-step wizards) |

Coarse means two product cards on the same page collapse to "the same state" — saves memory but the agent might not realise it has already explored one. Fine means every minor DOM difference is its own state — bigger tree, slower convergence, more thorough.

## `llm` block

### `llm.enabled`
`true` — use the LLM for predictions and surprise scoring.
`false` — skip LLM entirely. The agent runs on hard signals only (5xx / pageerror / 4xx / requestfailed). Still useful! Costs $0. Just dumber.

### `llm.model`
OpenAI model id. `gpt-4o-mini` (default) is the cheapest capable option. `gpt-4o` is more accurate but ~10× the cost.

### `llm.maxTokens` / `llm.temperature`
Standard OpenAI params. Defaults are fine; only touch if predictions are getting cut off (raise maxTokens) or are too random (lower temperature).

## `observability` block

### `observability.otel.enabled`
`true` — emit OTel spans to a JSONL file at `path`.
`false` — no spans. The agent still works, but `trace.jsonl` will be empty.

### `observability.otel.path`
The `${RUN_ID}` placeholder is substituted with the deterministic 8-char run hash. Putting traces inside `BUG/` keeps them git-ignored automatically.

### `observability.breadcrumbs`
Same shape, simpler format. Breadcrumbs are a flat JSONL log of "what the agent did." Easier to read than spans.

## `auth` block (optional)

Inject session cookies into the page **before** the first `goto`. Without this, the agent always starts logged out, which means the 80% of any real app behind login is unreachable.

```yaml
auth:
  cookies:
    - name: session_id
      value: abc123def456
      domain: my-staging-site.com
      path: /
      httpOnly: true
      secure: true
      sameSite: Lax
    - name: csrf
      value: xyz789
      url: https://my-staging-site.com   # alternative to domain
```

**Required fields per cookie:** `name`, `value`, and **either** `domain` or `url`.
Optional: `path`, `expires`, `httpOnly`, `secure`, `sameSite`.

How to grab cookies:
1. Log in to your staging site in a normal browser.
2. Open DevTools → Application → Cookies.
3. Copy `name`, `value`, `domain` for each cookie that's part of your auth (typically: a session/auth cookie + a CSRF cookie).
4. Paste into `config.yaml`.

**Don't commit real session tokens.** Either use a staging-only test account, or store the values in `.env` and reference them via env-var substitution in your launch command.

## `triage` block

### `triage.bugRoot`
Where bug folders go. Default `BUG`. Don't change unless you have a reason.

### `triage.github.enabled`
If `true` AND `GITHUB_TOKEN`/`GITHUB_REPO_OWNER`/`GITHUB_REPO_NAME` are set in `.env`, every bug folder also files a GitHub issue with the bug.md as the body.
