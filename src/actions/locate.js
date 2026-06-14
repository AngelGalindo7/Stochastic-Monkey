// Engine-agnostic xpath element query. Callers must pass an absolute xpath
// starting with '//' — relative forms break the Puppeteer prefix concatenation.
// Playwright resolves bare '//…' as xpath; Puppeteer/Lightpanda need 'xpath/.'.
export function queryByXPath(page, xpath) {
  if (!xpath.startsWith('//')) throw new Error(`queryByXPath: xpath must start with '//', got: ${xpath}`);
  if (page.engine === 'playwright') return page.raw.$$(xpath);
  return page.raw.$$('xpath/.' + xpath);
}
