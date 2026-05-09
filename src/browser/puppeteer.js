import puppeteer from 'puppeteer';

export async function launchPuppeteer({ headful = false } = {}) {
  const browser = await puppeteer.launch({
    headless: !headful,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  return {
    kind: 'puppeteer',
    raw: browser,
    async newPage() {
      const page = await browser.newPage();
      const events = [];
      page.on('pageerror', (err) =>
        events.push({ type: 'PAGEERROR', message: err.message, stack: err.stack }),
      );
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          events.push({ type: 'CONSOLE_ERROR', message: msg.text() });
        }
      });
      page.on('requestfailed', (req) =>
        events.push({
          type: 'REQUEST_FAILED',
          url: req.url(),
          reason: req.failure()?.errorText,
        }),
      );
      page.on('response', (res) => {
        const status = res.status();
        if (status >= 500) events.push({ type: 'HTTP_5XX', url: res.url(), status });
        else if (status >= 400) events.push({ type: 'HTTP_4XX', url: res.url(), status });
      });
      return { raw: page, events };
    },
    async close() {
      await browser.close();
    },
  };
}
