# Stochastic Monkey — Vibe Code QA Wrapper

## Sprint Plan: 4 Sprints x 1 Week

Turn Stochastic Monkey into a drop-in QA tool for Lovable, Bolt, v0, and other AI-generated web apps. Point it at a URL, get a bug report.

---

## Sprint 1 — CLI Wrapper & Target Auto-Detection

**Goal:** A user can run `npx stochastic-monkey https://my-app.lovable.app` with zero config.

### 1.1 CLI Entry Point
- New: `src/cli.js`
- Update: `package.json` `bin` field
- Parse a URL argument, auto-generate a temp `config.yaml`, run the scan
- Support `--preset lovable|bolt|generic` flag
- **Done when:** `npx stochastic-monkey <url>` works end-to-end

### 1.2 Framework Detector
- New: `src/perception/stackDetector.js`
- On first page load, sniff for React (`__REACT_DEVTOOLS`), Next.js (`__NEXT_DATA__`), Vite, Supabase client, Tailwind
- Log detected stack in breadcrumbs, use it to select relevant detectors
- **Done when:** detector correctly identifies React + Supabase on a Lovable app

### 1.3 Auto-Domain Scoping
- Update: `src/config/loader.js`
- Extract `allowedDomains` from the target URL
- Monitor network requests for 5 seconds to discover API domains (Supabase, Stripe, etc.)
- **Done when:** no manual `allowedDomains` config needed for single-domain apps

### 1.4 Preset Profiles
- New: `presets/lovable.yaml`, `presets/bolt.yaml`, `presets/generic-spa.yaml`
- Each preset tunes action weights, blocked selectors, data pools, and detector list for its platform
- Lovable preset blocks Supabase Studio links, prioritizes form + auth testing
- **Done when:** `--preset lovable` loads correct config

---

## Sprint 2 — Vibe Code Bug Detectors

**Goal:** Detect the top 8 issues AI-generated apps ship with. This is the money sprint.

### 2.1 Auth Flow Tester
- New: `src/detectors/authGate.js`
- Macro: signup -> login -> protected route -> logout -> revisit protected route
- Flag if protected route is accessible after logout
- **Done when:** detects unprotected routes on a Lovable app with Supabase auth

### 2.2 Dead Link / 404 Scanner
- New: `src/detectors/deadLinks.js`
- Crawl all `<a href>` on each visited page
- HEAD-request each, flag 404s with the source page as context
- **Done when:** finds broken links without navigating away from the app

### 2.3 Form Validation Tester
- New: `src/detectors/formValidation.js`
- For every `<form>`: submit empty, submit XSS payloads, submit SQL injection strings
- Flag if no client-side validation fires or if server returns 500
- **Done when:** catches missing validation on forms

### 2.4 Missing Error Boundary Detector
- New: `src/detectors/errorBoundary.js`
- Inject errors via `evaluate()` (e.g. call `undefined.foo` inside a React component)
- If the whole page goes white/blank instead of showing a fallback, flag it
- **Done when:** detects React apps without error boundaries

### 2.5 Responsive Breakpoint Checker
- New: `src/detectors/responsive.js`
- Resize viewport to 375px, 768px, 1024px, 1440px
- At each size, check for horizontal overflow (`scrollWidth > clientWidth`) and overlapping interactive elements
- **Done when:** catches overflow at mobile breakpoints

### 2.6 Console Error Aggregator
- New: `src/detectors/consoleErrors.js`
- Collect all `console.error` and unhandled promise rejections during the run
- Group by message, dedupe, rank by frequency
- **Done when:** surfaces noisy console errors as low-severity bugs

### 2.7 Missing Alt Text / A11y Checker
- New: `src/detectors/a11yLint.js`
- Flag images without `alt`, buttons without labels, inputs without associated labels
- Check ARIA roles are valid
- **Done when:** catches common a11y gaps in AI-generated markup

### 2.8 Supabase RLS Tester
- New: `src/detectors/supabaseRLS.js`
- If Supabase is detected (via stack detector), extract the anon key and project URL
- Try fetching common table names via the REST API with no auth token
- Flag if rows come back (missing Row Level Security)
- **Done when:** detects wide-open Supabase tables

---

## Sprint 3 — Report & Integration

**Goal:** Produce a human-readable HTML report and integrate with CI.

### 3.1 HTML Report Generator
- New: `src/report/htmlReport.js`, `src/report/template.html`
- Render all bugs into a single self-contained `report.html`
- Include screenshots, severity badges, repro steps, and a summary scorecard
- **Done when:** `--report html` produces a readable report file

### 3.2 JSON Report Output
- New: `src/report/jsonReport.js`
- Machine-readable `report.json` for CI consumption
- Exit code 1 if any critical/high bugs found
- **Done when:** `--report json` plus exit code works in GitHub Actions

### 3.3 Detector Runner Framework
- New: `src/detectors/runner.js`
- Update: `src/index.js`
- A registry that loads all `src/detectors/*.js`, runs them after the MCTS exploration phase, merges findings into the bug report
- **Done when:** adding a new detector is just dropping a file in `src/detectors/`

### 3.4 GitHub Action / CI Config
- New: `.github/workflows/monkey.yml`, `action.yml`
- Example workflow for running the monkey in CI on every PR preview deploy
- **Done when:** works as a GitHub Action with `uses: ./`

### 3.5 Health Scorecard
- Update: `src/report/htmlReport.js`, `src/cli.js`
- Compute an overall health score (0-100) from weighted bug counts by severity
- Critical = -25, High = -15, Medium = -5, Low = -1
- **Done when:** score prints to stdout and shows in HTML report header

---

## Sprint 4 — Polish & Packaging

**Goal:** Ship it as an installable tool anyone can use.

### 4.1 npm Package Setup
- Update: `package.json`
- Clean `bin`, `exports`, `engines`, description, keywords
- Package name: `stochastic-monkey` or `vibe-qa`
- **Done when:** `npm install -g` and `npx` both work

### 4.2 Watch Mode
- Update: `src/cli.js`
- `--watch` flag reruns the scan whenever the target URL's content hash changes (poll every 30s)
- Useful during active development
- **Done when:** `--watch` re-scans on detected changes

### 4.3 Live Progress Output
- Update: `src/index.js`
- Show current step, action taken, bugs found so far in real time
- Replace silent-until-done behavior
- **Done when:** user sees real-time progress during a scan

### 4.4 CLI Help & Dry Run
- Update: `src/cli.js`
- `--help` with usage examples
- `--dry-run` shows what would be tested without running
- `--list-detectors` shows available detectors with descriptions
- **Done when:** helpful CLI UX

### 4.5 Lovable Integration Guide
- New: `docs/LOVABLE_GUIDE.md`
- Step-by-step: get your Lovable preview URL, run the monkey, read the report
- Common fixes for each detector (e.g. "add an error boundary", "enable RLS")
- **Done when:** a Lovable user can follow the guide cold

### 4.6 Detector Test Coverage
- New: `tests/unit/detectors/*.test.js`
- Unit tests for each detector using mocked page objects
- **Done when:** all detectors have tests, `npm test` passes

---

## If Time Is Short

Priority order for maximum impact:

1. **Sprint 2 (all 8 detectors)** — this IS the product
2. **Sprint 1.1 + 1.4 (CLI + presets)** — usable entry point
3. **Sprint 3.1 + 3.3 (HTML report + runner)** — readable output
4. **Sprint 4.1 + 4.3 (packaging + progress)** — polished feel

Skip auto-detection (1.2, 1.3), CI integration (3.4), and watch mode (4.2) if cutting scope.

---

## Architecture After All 4 Sprints

```
src/
  cli.js                     # CLI entry point
  index.js                   # MCTS orchestrator (existing)
  browser/                   # Puppeteer + Lightpanda (existing)
  perception/
    a11yTree.js              # A11y snapshots (existing)
    stackDetector.js         # Framework/stack detection (new)
  agent/                     # MCTS + expectations (existing)
  llm/                       # Gemini + OpenAI (existing)
  detectors/
    runner.js                # Loads and runs all detectors
    authGate.js
    deadLinks.js
    formValidation.js
    errorBoundary.js
    responsive.js
    consoleErrors.js
    a11yLint.js
    supabaseRLS.js
  report/
    htmlReport.js
    jsonReport.js
    template.html
  triage/                    # Bug writing (existing)
  observability/             # OTel + breadcrumbs (existing)
presets/
  lovable.yaml
  bolt.yaml
  generic-spa.yaml
```
