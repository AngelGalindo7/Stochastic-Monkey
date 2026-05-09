# Heuristic Monkey — Bug Fix Log

Entry heading: `DD/MM/YYYY — fix(scope component): short title`
Body: 3–6 bullets — cause, fix, downstream risk. No code blocks.
Scopes: `agent` · `browser` · `perception` · `actions` · `llm` · `observability` · `triage` · `config` · `infra` · `docs`

---

06/05/2026 — fix(observability otel): use Resource class instead of resourceFromAttributes
- Import broke at startup with "does not provide an export named 'resourceFromAttributes'".
- Cause: `@opentelemetry/resources@1.30.1` ships the `Resource` class only; `resourceFromAttributes` was added in 2.x.
- Fix: imported `Resource` and constructed it directly with the same attributes object.
- Caught by the bug-hunter subagent during scaffold verification — agent process exited before any browser launched.
- Downstream risk: when we eventually upgrade to `@opentelemetry/resources@2.x` we'll want to flip back to `resourceFromAttributes` for cleaner ergonomics; both APIs accept the same attribute shape.
