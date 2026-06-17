# Mass-Testing Harness

A passive, decoupled orchestration layer that points Stochastic Monkey at many
vibe-coded apps (Lovable, Bolt, v0, Base44, …) and rolls the results into one
report. It talks to the monkey **only** through a generated `config.yaml` (in)
and the `BUG/` folder (out) — no monkey internals are touched.

**Mode: passive.** Read-only crawl — no form payloads, no destructive macros, no
auth. Only the deterministic hard-signal oracles fire (HTTP 5xx / 4xx-nav /
asset-4xx / pageerror / DOM_FROZEN). Safe for third-party apps you don't own.
Active testing is deliberately out of scope here.

## Passive scan boundary

**Performs:** GET-based page loads, browser JavaScript execution, link traversal
(clicking anchor elements), read-only accessibility-tree inspection, and recording
of HTTP response codes, JS console errors, and asset failures.

**Does not perform:** form submissions, authentication or login of any kind,
POST/PUT/PATCH/DELETE requests, typing into input fields, destructive macros, or
storage/exfiltration of application data.

This matches the standard passive-scanning definition: operations indistinguishable
from a user visiting the page in a normal browser. Active testing (auth, IDOR macros,
fuzzing) is explicitly out of scope and requires an ownership allowlist.

## The pipeline

```
discover ──► candidates.txt ──► classify ──► targets.jsonl ──► run-batch ──► results.jsonl ──► aggregate ──► report.md
 (CT logs)                     (live + FP)                    (monkey ×N)                     (+manifest)     (+disclosure)
```

### 1. Discover (Stages 1–2) — enumerate candidate hosts
```bash
node harness/discover.js [--apex lovable.app ...] [--out runs/candidates.txt]
```
Passively enumerates subdomains under platform apexes via crt.sh. (crt.sh is
often overloaded; you can also append `subfinder`/`amass` output to the file.)

### 2. Classify (Stages 3–5) — keep only live vibe-coded apps
```bash
node harness/classify.js runs/candidates.txt [--min-confidence 0.3] [--out runs/targets.jsonl]
```
Drops dead hosts (non-2xx/3xx), fingerprints the rest (Supabase anon JWT,
PostgREST, platform markers), and writes the vibe-coded ones to `targets.jsonl`
with platform + Supabase enrichment.

### 3. Run batch (Stage 6) — passive crawl each target
```bash
node harness/run-batch.js runs/targets.jsonl [--concurrency 4] [--timeout 150000] [--rate-ms 1000] [--deny-file PATH]
```
Denylist gate → concurrency pool → per-host rate limit → generate passive config
(absolute per-target `bugRoot`, collision-free) → run monkey (with per-step
watchdog) → harvest `BUG/` → `results.jsonl` + `manifest.jsonl`. **Resumable**:
re-running skips settled targets.

### 4. Aggregate (Stage 7) — report + disclosure queue
```bash
node harness/aggregate.js [--out runs]
```
Rolls `results.jsonl` + `manifest.jsonl` into `report.md` (severity / signal /
platform / status tables) and `disclosure-queue.jsonl` (critical + high).

## Quick start (a list you already have)
```bash
node harness/run-batch.js harness/targets.sample.txt --concurrency 2
node harness/aggregate.js
```

## Layout
```
harness/
├── discover.js  classify.js  run-batch.js  run-one.js  aggregate.js
├── config.template.yaml          # passive base config
├── targets.sample.txt
└── lib/  slug · genConfig · runMonkey · harvest · denylist · manifest ·
          pool · rateLimiter · fingerprint · discover · aggregate
```

## Safety rail
- **Denylist** (`lib/denylist.js`): gov/military/edu/health/finance dropped before
  any run; `--deny-file` adds custom hosts.
- **Passive template**: `INPUT=0`, `UPLOAD=0`, macros off, LLM off, destructive
  `blockedSelectors`.
- **Rate limiting** (`--rate-ms`) + **per-target timeout** + monkey **per-step
  watchdog** (`run.stepTimeoutMs`).
- High-severity findings go to a **disclosure queue** for responsible reporting.

Active testing (form payloads, auth/IDOR macros) is intentionally deferred and
would be gated behind an ownership allowlist.
