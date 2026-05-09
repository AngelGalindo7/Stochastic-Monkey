# Bug Report — MEDIUM
**URL:** https://the-internet.herokuapp.com/broken_images
**Seed:** 42
**Signal:** ASSET_4XX
**Surprise score:** 0.90
**Folder:** BUG/2026-05-09T23-15-44Z__seed42__medium
**Step screenshots:** BUG/e7e9aed2/steps/
## Evidence (raw page-level signals)

- **ASSET_4XX** — fail https://298279967.log.optimizely.com/event?a=298279967&d=298279967&y=false&n=https%3A%2F%2Fthe-internet.herokuapp.com%2Fbroken_images&u=oeu1778368542585r0.34924993949098304&wxhr=true&t=1778368542589&f=298349752,318188263
- **ASSET_4XX** — fail https://298279967.log.optimizely.com/event?a=298279967&d=298279967&y=false&n=https%3A%2F%2Fthe-internet.herokuapp.com%2Fbroken_images&u=oeu1778368542585r0.34924993949098304&wxhr=true&t=1778368543641&f=298349752,318188263
- **ASSET_4XX** — 404 https://the-internet.herokuapp.com/hjkl.jpg
- **ASSET_4XX** — 404 https://the-internet.herokuapp.com/asdf.jpg
- **ASSET_4XX** — fail https://298279967.log.optimizely.com/event?a=298279967&d=298279967&y=false&n=https%3A%2F%2Fthe-internet.herokuapp.com%2Fbroken_images&u=oeu1778368542585r0.34924993949098304&wxhr=true&t=1778368543788&f=298349752,318188263
- **ASSET_4XX** — fail https://298279967.log.optimizely.com/event?a=298279967&d=298279967&y=false&n=https%3A%2F%2Fthe-internet.herokuapp.com%2Fbroken_images&u=oeu1778368542585r0.34924993949098304&wxhr=true&t=1778368543641&f=298349752,318188263
- **ASSET_4XX** — fail https://298279967.log.optimizely.com/event?a=298279967&d=298279967&y=false&n=https%3A%2F%2Fthe-internet.herokuapp.com%2Fbroken_images&u=oeu1778368542585r0.34924993949098304&wxhr=true&t=1778368542589&f=298349752,318188263
- **ASSET_4XX** — 404 https://the-internet.herokuapp.com/asdf.jpg
- **ASSET_4XX** — 404 https://the-internet.herokuapp.com/hjkl.jpg

## Steps the agent took before failure
1. goto https://the-internet.herokuapp.com/broken_images
2. step=0 macro="refresh_loop"
## Predicted outcome

> The action will probably navigate or change the visible content.

## How to reproduce
```
node BUG/2026-05-09T23-15-44Z__seed42__medium/repro.js
```
See `breadcrumbs.jsonl` for the full event log, `trace.jsonl` for OTel spans, and `steps/<n>.png` (in the run-id folder) for the per-step screenshot timeline.