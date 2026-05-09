# Observability

## Stack

| Component | Choice |
|---|---|
| SDK | `@opentelemetry/sdk-trace-node` |
| API | `@opentelemetry/api` |
| Exporter | Custom — `src/observability/fileExporter.js`, writes JSONL to `BUG/<run_id>/trace.jsonl` |
| Resource attributes | `service.name=heuristic-monkey`, `run.id`, `run.seed` |

No Datadog, Sentry, or SigNoz. See DECISION_LOG entry 004 for the rationale.

## Span shape

Spans follow the standard OTel envelope; we add structured attributes per category:

```jsonc
{
  "traceId": "...",
  "spanId": "...",
  "parentSpanId": "...",
  "name": "mcts.expand",
  "startTime": "2026-05-06T12:34:56.123Z",
  "endTime":   "2026-05-06T12:34:56.140Z",
  "attributes": {
    "run.id": "a3f9c1b2",
    "run.seed": 42,
    "step": 7,
    "state.id": "8c2d4...",
    "parent.state.id": "1e9a...",
    "untried.count": 3
  },
  "status": { "code": "OK" }
}
```

## Why a custom exporter

The OTLP exporter (`@opentelemetry/exporter-trace-otlp-http`) wants a collector endpoint. Local development with no collector is awkward — the SDK retries, fails, and floods stderr. A file exporter is one screen of code and gives us:

- Replay: `cat BUG/<run_id>/trace.jsonl | jq` for human inspection.
- Diff: `diff BUG/<a>/trace.jsonl BUG/<b>/trace.jsonl` to compare two runs.
- Replay testing: load JSONL into a test fixture to assert a specific span sequence.

When we deploy somewhere with a collector, add the OTLP exporter as a *second* processor. Don't remove the file exporter.

## Breadcrumbs vs. spans

`src/observability/breadcrumbs.js` is a parallel, simpler log: a `JSONL` file (`BUG/<run_id>/breadcrumbs.jsonl`) of `{ ts, step, type, summary }` records. Spans are exhaustive; breadcrumbs are scannable. Both are written to the same `BUG/<run_id>/` folder so triage can pick whichever fits.

A reviewer reading a bug report can tail `breadcrumbs.jsonl` to follow the agent's narrative; an engineer reproducing the bug locally can grep `trace.jsonl` for the exact LLM prompt that misled the prediction.

## What the bug-hunter subagent looks for

The verification step in this scaffold is a Claude subagent that runs `npm start` and inspects:

1. `BUG/<run_id>/` exists.
2. `trace.jsonl` is non-empty and contains at least one `expectations.surprise` span with `score >= 0.85` (or a hard-signal override flag).
3. `breadcrumbs.jsonl` ends with a terminal-failure event.
4. `bug.md` correctly states the page URL, severity, and hard signal.

If any check fails, the subagent picks a different starting URL from the rotation list and retries (up to 3 times).
