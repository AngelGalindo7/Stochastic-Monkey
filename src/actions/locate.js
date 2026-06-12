// Engine-agnostic xpath element query. Playwright resolves a bare '//…' string
// as an xpath selector; Puppeteer and Lightpanda both use the 'xpath/' selector-
// prefix convention instead. Action handlers build absolute '//…' expressions
// and route them through here so one call site works on every engine — making
// the default-engine switch to Playwright stop silently breaking every click
// and input.
export function queryByXPath(page, xpath) {
  if (page.engine === 'playwright') return page.raw.$$(xpath);
  return page.raw.$$('xpath/.' + xpath);
}
