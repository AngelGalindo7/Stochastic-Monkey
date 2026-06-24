# Contributing to Heuristic Monkey

## Setup

```bash
npm install    # downloads Chromium for Puppeteer
cp .env.example .env
npm test       # vitest — must be green before you open a PR
```

## Running against a local app

Edit `config.yaml` and set `target.url` to your app's local URL, then:

```bash
npm start            # passive scan — read-only, safe default
npm start --active   # active scan — enables form fills and authz replay
```

See **Running Modes** in [README.md](README.md) for the full distinction.

## How to add a new oracle

Step-by-step:

1. Create `src/agent/oracles/myOracle.js` and export `checkMyOracle(options)`
2. Add signal constants to `HARD_SIGNALS` in `src/agent/expectations.js`
3. Wire it in `src/index.js`: step-level oracles go in the `ORACLE_REGISTRY` in `src/agent/oracles/registry.js`; run-level oracles (called once after the arm loop) go in `main()` alongside `authzReplay`
4. Write `tests/unit/myOracle.test.js`

Code template:

```js
/**
 * @param {{ captures: object[], allowedDomains: string[], config: object, client?: object }} options
 * @returns {Promise<{ signal: string|null, detail?: string }>}
 */
export async function checkMyOracle({ captures, allowedDomains, config }) {
  if (!config.oracle?.myOracle?.enabled) return { signal: null };
  // detection logic here
  return { signal: null }; // or { signal: 'MY_SIGNAL', detail: 'description' }
}
```

## Oracle contract

Every oracle returns `{ signal: string|null, detail?: string }`.

Two tiers:

- **auto-assert**: fires when the finding has NO ambiguous legitimate interpretation — creates a `BUG/` artifact. Examples: HTTP 500, duplicate resource IDs from an idempotency-key replay. Rule: do not use auto-assert if any legitimate server behavior can produce the same signal.
- **flag-for-review**: fires when a human must confirm whether the finding is a real bug — creates a `FLAGGED/` artifact. Examples: missing security header, CORS misconfiguration, authorization leak.

## How to add a new action type

Three-file change:

1. Create `src/actions/myAction.js` exporting `async function myAction(page, opts)`
2. Register it in `src/actions/macro.js` (or equivalent action dispatcher)
3. Add a weight entry in `config.yaml` under `actions.weights`

## Pull request conventions

- One file per commit. Commit message format: `type(scope component): description`
- Valid scopes: `agent` · `browser` · `perception` · `actions` · `llm` · `observability` · `triage` · `config` · `infra` · `docs`
- Valid types: `feat` · `fix` · `chore` · `docs` · `test` · `refactor` · `perf` · `ci`
- Examples: `feat(agent mcts): add UCB1 selection`, `fix(browser puppeteer): handle navigation timeout`
- Never bundle unrelated files in one commit.
- `npm test` must pass before merging.

## Commit message format

```
type(scope component): description
```

Single line only. Types: `feat` `fix` `chore` `docs` `test` `refactor` `perf` `ci`

Scopes: `agent` `browser` `perception` `actions` `llm` `observability` `triage` `config` `infra` `docs`

Never add `Co-Authored-By` trailers. Never commit files under `docs/`.

## Running tests

```bash
npm test                                                        # unit tests (vitest)
npx playwright install chromium --with-deps                    # one-time setup for integration smoke
npx vitest run tests/smoke/integration.test.mjs                # integration smoke
```

## Ethical use

Do not run this tool against web apps you do not own or have written permission to test.
