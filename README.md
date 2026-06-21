# Heuristic Monkey

A Monte Carlo Tree Search bug hunter for web apps. The agent explores a target site stochastically, asks an LLM to predict what each action *should* do, and rewards itself when reality diverges from the prediction. Crashes, 5xx responses, broken images, and silent JS errors override the LLM and force a maximal "surprise" reward — so the search aggressively zooms in on real bugs.

Local-only. ~$0/month plus OpenAI usage (cents per run).

## Quick Start

```bash
npm install                # downloads Chromium for Puppeteer
cp .env.example .env       # add OPENAI_API_KEY (optional)
npm test                   # vitest — should be green
npm start                  # runs config.yaml against the default target
```

## Running Modes

```bash
npm start            # passive — read-only scan, safe for any public app
npm start --active   # active  — enables form submission, payload injection, and authz replay
```

**Passive mode (default):** navigates, clicks, and records HTTP/console errors. Never submits forms, injects XSS/SQLi payloads, or replays authenticated reads as an anonymous client. Safe to run against apps you don't own.

**Active mode (`--active`):** enables `FORM_FILL`, `INPUT`, `UPLOAD`, and authz-replay probes. Only use against apps you own or have written permission to test.

## Bug Artifacts

Failures land in `BUG/<iso8601>__seed<n>__<severity>/`:

```
BUG/2026-05-06T12-34-56Z__seed42__medium/
├── screenshot.png      # page state at detection
├── dom.html            # full DOM snapshot
├── breadcrumbs.jsonl   # ordered action log
├── trace.jsonl         # OTel spans
├── bug.md              # summary: URL, severity, signal, repro steps
├── severity.json       # machine-readable severity signal
└── repro.js            # reruns the exact seed deterministically
```

A parallel `BUG/<run_id>/` folder holds the per-step screenshot timeline.

## Configuration

Edit `config.yaml`:

| Key | Purpose |
|-----|---------|
| `target.url` | Starting URL |
| `target.allowedDomains` / `target.blockedSelectors` | Hard navigation guards |
| `actions.weights` | Prior over CLICK / INPUT / NAVIGATION / SCROLL |
| `mcts.ucbC` / `mcts.rolloutDepth` | Exploration tuning |
| `llm.enabled` / `llm.model` | Disable to run in pure hard-signal mode |
| `auth.cookies` | Pre-login cookies applied before first `goto` |

## Environment Variables

See `.env.example` for the full list. Key vars:

- `OPENAI_API_KEY` — required for LLM-guided exploration
- `GITHUB_TOKEN` + `GITHUB_REPO_OWNER` + `GITHUB_REPO_NAME` — auto-file GitHub issues on bugs
- `LIGHTPANDA_BIN` — path to Lightpanda binary (optional, Linux only)
