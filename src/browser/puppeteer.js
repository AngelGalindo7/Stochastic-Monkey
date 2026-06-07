import puppeteer from 'puppeteer';

export async function launchPuppeteer({ headful = false, userDataDir } = {}) {
  const browser = await puppeteer.launch({
    headless: !headful,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
    ...(userDataDir ? { userDataDir } : {}),
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
          events.push({ type: 'CONSOLE_ERROR', message: msg.text(), url: msg.location()?.url });
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
        if (status < 400) return;
        const resourceType = res.request()?.resourceType?.() ?? 'other';
        const type = status >= 500 ? 'HTTP_5XX' : 'HTTP_4XX';
        events.push({ type, url: res.url(), status, resourceType });
      });
      return { raw: page, events };
    },
    async close() {
      await browser.close();
    },
  };
}
