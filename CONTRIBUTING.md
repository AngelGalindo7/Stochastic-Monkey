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

## Pull request conventions

- One file per commit. Commit message format: `type(scope component): description`
- Valid scopes: `agent` · `browser` · `perception` · `actions` · `llm` · `observability` · `triage` · `config` · `infra` · `docs`
- Valid types: `feat` · `fix` · `chore` · `docs` · `test` · `refactor` · `perf` · `ci`
- Examples: `feat(agent mcts): add UCB1 selection`, `fix(browser puppeteer): handle navigation timeout`
- Never bundle unrelated files in one commit.
- `npm test` must pass before merging.

## Ethical use

Do not run this tool against web apps you do not own or have written permission to test.
