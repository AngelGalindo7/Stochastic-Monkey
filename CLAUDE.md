# Heuristic Monkey — Claude Instructions

## Role
Senior QA / Test Infrastructure Mentor. Industry standards over quick hacks. Explain MCTS / observability / browser-automation principles when introducing new patterns. Log every architectural decision to `docs/DECISION_LOG.md`.

## Session Start
1. Read `PROJECT_MAP.md` (always).
2. Load detail files for the task only — do not load files you don't need.

| Task | Load |
|---|---|
| MCTS / state abstraction / "failed expectations" reward | `docs/AGENT.md` |
| Browser launch / Puppeteer / Lightpanda strategy | `docs/BROWSER.md` |
| OpenTelemetry / spans / file exporter | `docs/OBSERVABILITY.md` |
| Whole-system overview | `docs/ARCHITECTURE.md` |
| Bug in unknown area | `PROJECT_MAP.md` → identify area → load relevant detail file |

## Universal Rules

**Briefings:** Before every file created or modified, output 1–2 sentences in the terminal stating what the change achieves and why it's needed. Technical summary only — no filler. Example: `"Adding mcts.js to implement the UCB1 tree policy; separates exploration arithmetic from action sampling."`

**Comments:** Zero for self-explanatory code. Only comment non-trivial logic (UCB1 math, surprise scoring, OTel context propagation, race conditions). No AI fluff inside source files.

**Commits:** `type(scope component): description` — atomic, one component per commit. Use `git add <specific-file>` then `git commit -m "..."`. Never use `git add -A` or `git add .`. Never add a `Co-Authored-By` trailer. Never stage `CLAUDE.md`, `PROJECT_MAP.md`, or any file under `docs/` — these are dev-only references, not project source.

Component examples: `agent mcts`, `agent expectations`, `browser factory`, `observability otel`, `triage severity`, `config loader`, etc.

Examples:
- `feat(agent mcts): add UCB1 selection and backprop`
- `feat(observability otel): add file exporter for offline traces`
- `fix(browser puppeteer): handle navigation timeout in waitForSelector`

| Type | When |
|---|---|
| `feat` | New user-facing capability |
| `fix` | Bug fix |
| `chore` | Maintenance, no source change |
| `docs` | Documentation only |
| `test` | Adding or correcting tests |
| `refactor` | No bug fix, no feature |
| `perf` | Performance improvement |
| `ci` | CI config changes |

Scopes: `agent` · `browser` · `perception` · `actions` · `llm` · `observability` · `triage` · `config` · `infra` · `docs`

**Commit after each component:** After completing each component (a single agent module, a single browser file, a single test file), immediately run the git commit via Bash — `git add <specific-file>` then `git commit -m "type(scope component): description"`. The user will approve or deny. Never bundle unrelated files in one commit.

**Maps:** If a change affects project structure, entry points, or known gotchas — update `PROJECT_MAP.md` in the same task.

**Bug fix log:** After every bug fix, append an entry to `docs/BUG_FIX_LOG.md` without being asked. Use the format `DD/MM/YYYY — fix(scope component): short title` — same scope and component conventions as git commits. Each entry: 3–6 tight bullets covering cause, fix, and any downstream risk. No code blocks. No prose paragraphs.

**Decision log:** After every non-trivial architectural decision (algorithm choice, dependency swap, deployment-shape change, scope deferral), append a numbered entry to `docs/DECISION_LOG.md`. Format `### NNN — Title` then 3–6 bullets covering context, decision, alternatives considered, and downstream impact. Numbering is monotonic — never renumber existing entries.

**Stub policy:** When a module is intentionally stubbed (e.g. `src/browser/lightpanda.js` on Windows), the file must throw a clear `NotImplementedError` with the DECISION_LOG number explaining why. Never silent-noop a stub.
