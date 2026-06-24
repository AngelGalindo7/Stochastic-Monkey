![CI](https://github.com/AngelGalindo7/heuristic-monkey/actions/workflows/ci.yml/badge.svg)

# Heuristic Monkey

A Monte Carlo Tree Search bug hunter for web apps. The agent explores a target site stochastically, asks an LLM to predict what each action *should* do, and rewards itself when reality diverges from the prediction. Crashes, 5xx responses, broken images, and silent JS errors override the LLM and force a maximal "surprise" reward — so the search aggressively zooms in on real bugs.

Local-only. ~$0/month plus OpenAI usage (cents per run).

## How it works

Heuristic Monkey uses MCTS (Monte Carlo Tree Search) to explore a web app — a tree search algorithm that balances exploring new parts of your app with revisiting areas where bugs were found. Each unique page state is represented as a snapshot of the browser's accessibility tree (the same semantic structure screen readers use), so two pages that look visually different but share the same interactive elements are treated as the same state. Hard signals — HTTP 500 responses, uncaught JavaScript errors, and broken image loads — detect bugs deterministically without any interpretation: when one fires, the agent scores that path maximally and focuses exploration there. The LLM layer is optional; all hard-signal detection works without an API key, and the LLM only adds soft "surprise" scoring to catch regressions that don't crash outright.

## Quick Start

```bash
npm install                # downloads Chromium for Puppeteer
cp .env.example .env       # add OPENAI_API_KEY (optional)
npm test                   # vitest — should be green
npm start                  # runs config.yaml against the default target
npm start -- --url https://myapp.lovable.app   # override target URL without editing config.yaml
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

## Targeting your app

Point the monkey at any SPA by setting the target URL and allowed domains in `config.yaml`:

```yaml
target:
  url: https://your-app.example.com
  allowedDomains: ["your-app.example.com", "api.your-app.example.com"]
```

For apps requiring authentication, supply cookies in `config.yaml`:

```yaml
auth:
  cookies:
    - name: session
      value: "your-session-token"
      domain: "your-app.example.com"
```

Use passive mode (default) for apps you do not own — it never submits forms or mutates state. Use active mode (`--active`) for apps you own to enable form submission and authorization probes.

## Environment Variables

See `.env.example` for the full list. Key vars:

- `OPENAI_API_KEY` — required for LLM-guided exploration
- `GITHUB_TOKEN` + `GITHUB_REPO_OWNER` + `GITHUB_REPO_NAME` — auto-file GitHub issues on bugs
- `LIGHTPANDA_BIN` — path to Lightpanda binary (optional, Linux only)

## Troubleshooting

**Auth cookies have expired** — re-export fresh cookies from your browser DevTools (Application > Cookies) and update the `auth.cookies` section in `config.yaml`. Cookies are applied before each run.

**Forms are not being submitted** — the tool runs in passive mode by default, which never submits forms. Run with `--active` to enable form submission and write-dependent oracles.

**No bugs found** — this may mean the app is well-built, or the exploration did not reach the buggy path. Increase `mcts.maxSteps` in `config.yaml` to explore more paths. Change `mcts.seed` to explore a statistically independent trajectory.
