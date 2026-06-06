# Mass Vibe-Code Testing Harness — Plan

A blueprint for a **batch harness** that sits *in front of* Stochastic Monkey and feeds it
vibe-coded app targets at scale. Modeled on the escape.tech methodology
(acquire URLs → enumerate subdomains → filter to live apps → fingerprint as vibe-coded →
test). Stochastic Monkey is the "test" stage; this script is everything upstream plus a batch
runner and aggregator.

**Mode for v1: PASSIVE.** Mass-scan many third-party apps with read-only oracles only.
Active testing (form-submit payloads, auth/IDOR macros, delete flows) comes later and only
against apps you own or have written permission to test.

---

## Integration contract (how the harness talks to the Monkey)

The harness and the Monkey stay **decoupled**. They communicate through exactly two files:

- **In:** a generated `config.yaml` (target URL, allowed domains, mode, enrichment).
- **Out:** the `BUG/<run_id>/` folder the Monkey writes.

This means **no Monkey internals are modified** — the harness only orchestrates subprocess
runs. The same harness keeps working as the Monkey evolves (Playwright default, future
persistence/authz detectors).

---

## Stage 0 — Scope & safety rail (build this FIRST)

For passive mass-scanning of third-party apps, these constraints are code, not intentions:

- **Hard denylist filter** — drop gov, health, education, finance, and any PII-sensitive
  domains *before* a target reaches the Monkey. Mirrors escape.tech excluding health/edu.
- **Passive/safe switch (default ON)** — only read-only oracles run:
  crash/HTTP/`5xx`, broken-asset `4xx`, exposed-secret detection, Supabase RLS **read** probe.
  Destructive macros (form-submit-with-payloads, delete flows, auth brute-force) are **disabled**.
- **Rate limiting + concurrency caps + `robots.txt` respect** per host.
- **Ownership allowlist gate** — active mode refuses to run against anything not on it.
  (Not used in v1, but the gate exists so passive is the only path until you flip it.)
- **Disclosure log** — every confirmed finding is tracked toward responsible reporting.

---

## Stage 1 — Target acquisition (URL gathering)

Source adapters, each emitting raw candidates into one normalized list:

- **Platform directories:** `launched.lovable.dev` (~4k), `base44.com`, `create.xyz`,
  `bolt.new`, `vibe-studio.ai` galleries.
- **Certificate transparency:** `crt.sh` for `*.lovable.app`, `*.base44.com`, etc. — passive,
  high yield.
- **Shodan / FOFA:** queries on the Stage 4 platform fingerprints.
- **Community scrape:** Reddit `r/lovable` etc. — posts/comments linking live apps.
- **Output:** `candidates.jsonl` → `{url, source, discovered_at}`.

## Stage 2 — Subdomain enumeration

Expand each apex into hosts, passive-first:

- `subfinder` + `assetfinder` + `amass` (passive mode).
- `crt.sh` cert-transparency cross-check.
- **Output:** deduped `hosts.jsonl`.

## Stage 3 — Liveness & landing-page filtering

Mirror "keep 200–399, drop landing pages, dedupe":

- `httpx` probe → keep `2xx/3xx`; capture status, title, final URL, headers, tech hints.
- Drop platform marketing/landing pages, parked domains, "coming soon."
- Dedupe by final-redirect URL + content hash.
- **Output:** `live.jsonl`.

## Stage 4 — Vibe-code fingerprinting (the classifier)

The heart of "only test vibe-coded apps." Score each live host, tag its platform:

- **Supabase anon JWT** in the JS bundle (the big one — also the RLS attack surface).
- **PostgREST endpoint shape** (`/rest/v1/...`) and `*.supabase.co` calls in network traces.
- **Build artifacts:** Vite fingerprints, platform meta tags, comment banners, asset paths.
- **Hosting headers:** Vercel/Netlify edge headers common to these deploys.
- Score → `{platform, confidence}`; below threshold → discard.
- **Output:** `targets.jsonl` — curated set with platform + detected Supabase URL/anon-key.

## Stage 5 — Attack-surface enrichment (pre-flight per target)

Extract what makes each run smart (feeds the Monkey's config + RLS detector):

- Parse JS for **Supabase URL + anon key**, API base paths, auth endpoints.
- Pull routes from the JS router / sitemap so the crawl starts wide.
- **Output:** per-target enrichment blob.

## Stage 6 — Batch runner (the script's core loop)

For each curated target:

1. **Generate `config.yaml`** from a template — set `target.url`, `allowedDomains`
   (host + its Supabase domain), `blockedSelectors`, **mode: passive**, inject enrichment
   (Supabase creds → RLS read probe).
2. **Invoke the Monkey** as a subprocess (`node src/index.js --config <generated>`), one
   isolated run per target, with a **seed** for reproducibility.
3. **Concurrency pool** (N workers) with per-host rate limits and a per-target global timeout
   so one hung app can't stall the batch.
4. **Harvest** the `BUG/<run_id>/` folder, tag it with target + platform.
5. **Resume/idempotency** — a manifest tracking done/failed/pending so a 5,600-target run can
   stop and restart.

## Stage 7 — Aggregation & reporting

- Merge all `BUG/` outputs into one **cross-target index**: group by signal type
  (`HTTP_5XX`, `CONSOLE_ERROR`, exposed-Supabase-token, RLS-read-leak), by platform, by severity.
- **Dedupe** identical findings across many apps (the same template bug recurs everywhere).
- Emit a **summary dashboard** (counts, top signals, per-platform breakdown) + a
  **disclosure queue** for confirmed high-severity items.

---

## Passive-mode oracle set (v1)

Only these run against third-party targets. All are read-only / observational:

| Oracle | What it observes | Destructive? |
|---|---|---|
| Crash / HTTP `5xx` | server errors on navigation | no |
| Broken-route / broken-asset `4xx` | dead links, missing assets | no |
| Console error / page exception | silent JS errors | no |
| Blank-screen (`DOM_FROZEN`) | white-screen render after load | no |
| Exposed secret | Supabase anon JWT / API keys in JS bundle | no |
| Supabase RLS **read** probe | unauthenticated `GET /rest/v1/<table>` returns rows | read-only |

**Explicitly OFF in passive mode:** form submission with XSS/SQLi payloads, auth
signup/login brute-force, delete/edit flows, cross-account write replay, any `POST/PUT/DELETE`.

---

## Build order

| Step | Build | Why first |
|---|---|---|
| 1 | Stage 6 batch runner against **3–5 targets you own** | Prove config-gen → Monkey → harvest before scale |
| 2 | Stage 0 scope/safety rail (denylist, passive switch, rate limit) | Must exist before any third-party host |
| 3 | Stage 3 liveness (`httpx`) + Stage 4 fingerprinter | The classifier makes it vibe-code-only |
| 4 | Stage 1–2 acquisition + enumeration adapters | Fill the funnel once downstream is safe |
| 5 | Stage 5 enrichment + Stage 7 aggregation | Smarter runs, readable results |

**The decision already made:** v1 is passive — read-only oracles + rate limits + denylist +
disclosure. Active mode (form/auth/IDOR macros) is deferred and gated behind the ownership
allowlist.

---

# Stage 6 — Detailed Design (build status: single-target driver DONE)

## What exists now (`harness/`)

```
harness/
├── config.template.yaml     # passive base template (INPUT=0, UPLOAD=0, macros off, llm off)
├── run-one.js               # single-target driver CLI: gen → run → harvest
└── lib/
    ├── slug.js              # url/host → filesystem-safe slug for output isolation
    ├── genConfig.js         # render per-target config.yaml from the template
    ├── runMonkey.js         # spawn the monkey subprocess + hard timeout + log capture
    └── harvest.js           # read BUG/ severity.json files → normalized findings
```

Run one target:

```bash
node harness/run-one.js <url> [seed]
# e.g. node harness/run-one.js https://the-internet.herokuapp.com/status_codes/500 42
```

Output lands in `runs/<slug>/` (gitignored): the generated `config.yaml`, `run.log`,
and the isolated `BUG/` dir.

## The two integration levers (confirmed in code)

1. **Env override** — `loader.js` maps `HEURISTIC_SEED → run.seed`,
   `HEURISTIC_TARGET_URL → target.url`, `HEURISTIC_MAX_STEPS`, `HEURISTIC_LLM_*`.
   The driver passes seed via env; everything else via the generated file.
2. **Absolute `triage.bugRoot`** — `triage.js` does `path.resolve(PROJECT_ROOT, bugRoot)`,
   and `path.resolve` ignores `PROJECT_ROOT` when bugRoot is absolute. So each target's
   output is fully harness-owned and **collision-free even with identical seed+timestamp**.
   This is the single most important design choice; `runId = sha1(seed + ts-to-seconds)`
   collides otherwise.

## Per-target run lifecycle (implemented)

1. `slugify(url)` → `runs/<slug>/`.
2. `generateConfig()` clones `config.template.yaml`, fills `target.url`,
   `target.allowedDomains` (host + any enrichment Supabase host), `run.seed`, and the
   absolute `triage.bugRoot` + `${RUN_ID}`-templated otel/breadcrumb paths.
3. `runMonkey()` spawns `node src/index.js --config <gen>` with `HEURISTIC_SEED`, captures
   stdout/stderr to `run.log`, and SIGKILLs on a hard timeout (default 150s).
4. `harvest()` scans `runs/<slug>/BUG/*__seed*__*/severity.json` → normalized findings
   `{slug, url, platform, severity, signal, surpriseScore, folder}`.

Proven against a known-500 page: surfaced `HTTP_5XX` (critical) + `ASSET_4XX` findings,
correctly isolated, timeout-kill harvested partial results.

## Stage 6b — Batch runner (DONE)

```
node harness/run-batch.js <targets-file> [--concurrency N] [--seed N] [--timeout MS] [--deny-file PATH] [--out DIR]
```

`targets-file` is `.txt` (one URL per line) or `.jsonl`
(`{"url","platform","supabaseUrl"}` per line, enrichment carried into the config).

Built and proven:
- **Denylist gate** (`lib/denylist.js`) — gov/military/edu/health/finance dropped
  before spawn; `--deny-file` adds custom hosts. Verified: a `*health*` host → `skipped`.
- **Concurrency pool** (`lib/pool.js`) — N workers, errors isolated per target.
- **Manifest** (`lib/manifest.js`, append-only `manifest.jsonl`) — resume skips
  settled targets. Verified: re-run → `queued=0 resumed-skip=3`.
- **`results.jsonl`** — one normalized finding per line + a severity summary.

**Status model:** `done` (exit 0) / `timeout` / `skipped` are settled (not retried);
only `failed` (crash, non-zero exit) is retry-eligible. Timeout is settled because
the seed is fixed → a retry is deterministic and would just time out again.

## Known issue — monkey hangs on navigating clicks (affects throughput)

During the 6b run, `example.com` burned the full timeout: the monkey hung on
`step=0 CLICK on "Learn more"` (an off-domain navigating link) and never advanced.
The harness contained it correctly (timeout → SIGKILL → partial harvest), but at
mass scale a clean app eating the full per-target timeout is a throughput killer
(5,600 × 80s ≈ days). **This is a monkey-level bug, not a harness bug.**

Recommended fix (monkey-side, next): a **per-step watchdog** inside `index.js` that
caps any single action+snapshot cycle (e.g. 8–10s) so a hung navigation aborts the
step instead of the whole run. Harness-side mitigation meanwhile: a tighter
`--timeout`.

## What's left in Stage 6 / Stage 7

| Step | Build | Notes |
|---|---|---|
| 6c | **Per-host token-bucket rate limit** | politeness for shared apex infra (`*.lovable.app`) |
| 6d | **Monkey per-step watchdog** | fixes the hang above; biggest throughput win |
| 7  | **Aggregation/report** over `results.jsonl` | dedupe cross-target, per-platform dashboard |

## Note: master breakage fixed on this branch to unblock

The pulled `master` couldn't boot — the half-committed UPLOAD feature was missing
`src/actions/upload.js` and the `getFileInputs` export in `a11yTree.js`, and `playwright`
wasn't installed. All three were restored/installed so the monkey runs. These are unrelated
to the harness and may want reconciling with whatever PR originally added UPLOAD.
