# Bug Report — CRITICAL
**URL:** https://the-internet.herokuapp.com/status_codes/500
**Seed:** 3003
**Signal:** HTTP_5XX
**Surprise score:** 1.00
**Folder:** BUG\2026-05-07T06-14-02Z__seed3003__critical
**Step screenshots:** BUG/b646dc54/steps/
## Evidence (raw page-level signals)

- **HTTP_5XX** — 500 https://the-internet.herokuapp.com/status_codes/500
- **ASSET_4XX** — fail https://298279967.log.optimizely.com/event?a=298279967&d=298279967&y=false&n=https%3A%2F%2Fthe-internet.herokuapp.com%2Fstatus_codes%2F500&u=oeu1778134417634r0.19048899256006657&wxhr=true&t=1778134441948&f=298349752,318188263

## Steps the agent took before failure
1. goto https://the-internet.herokuapp.com/status_codes/500
2. step=0 macro="submit_form_and_resubmit"
3. step=1 CLICK on "here"
4. step=2 macro="refresh_loop"
5. step=3 CLICK on "Fork me on GitHub"
6. step=4 CLICK on "Elemental Selenium"
7. step=5 BACK on "-"
8. step=6 macro="submit_form_and_resubmit"
9. step=7 REFRESH on "-"
10. step=8 FORWARD on "-"
## Predicted outcome

> The page will navigate forward to the next item in the browsing history.

## How to reproduce
```
node BUG/2026-05-07T06-14-02Z__seed3003__critical/repro.js
```
See `breadcrumbs.jsonl` for the full event log, `trace.jsonl` for OTel spans, and `steps/<n>.png` (in the run-id folder) for the per-step screenshot timeline.