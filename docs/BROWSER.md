# Browser

## Strategy

`src/browser/browserFactory.js` exposes a single async factory:

```js
const browser = await createBrowser({ preferLightpanda: true });
const page = await browser.newPage();
```

Internally:

1. If `process.platform === 'win32'` OR `LIGHTPANDA_BIN` env is unset → use Puppeteer directly.
2. Else try `lightpanda.launch()`. On any thrown error, fall back to Puppeteer with a `WARN browser.lightpanda_unavailable` log.

The factory's *external* contract is the Puppeteer-shaped page interface — `goto`, `click`, `type`, `screenshot`, `evaluate`, `accessibility.snapshot`, plus event hooks (`on('pageerror', ...)`, etc.). When Lightpanda is in use, `src/browser/lightpanda.js` is responsible for adapting Lightpanda's surface to that contract.

Today, `src/browser/lightpanda.js` is intentionally a stub (see DECISION_LOG 002).

## Puppeteer launch options

```js
{
  headless: process.env.HEADFUL !== 'true',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1280, height: 800 },
}
```

`HEADFUL=true` opens a real Chromium window for debugging the agent live. Useful when investigating why the policy is stuck in a loop.

## Page event wiring

`src/browser/puppeteer.js` registers four listeners every time a page is created:

| Puppeteer event | Forwarded to |
|---|---|
| `console` (level=error) | `breadcrumbs.recordEvent('console.error', ...)` + OTel span `page.event.console_error` |
| `pageerror` | `breadcrumbs.recordEvent('pageerror', ...)` + OTel span `page.event.pageerror` (severity high) |
| `requestfailed` | OTel span `page.event.requestfailed` |
| `response` (status >= 400) | OTel span `page.event.response_4xx` or `page.event.response_5xx` |

These events feed `expectations.surprise()` as hard signals.

## Why not Playwright

Playwright would handle multi-tab and cross-browser nicely. We don't need either — the brief is single-tab Chromium-shaped exploration, and Lightpanda is the long-term swap target, not Firefox/WebKit. Puppeteer is the smaller surface and matches Lightpanda's CDP-shaped expectations.
