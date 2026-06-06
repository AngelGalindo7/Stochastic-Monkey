import puppeteer from 'puppeteer';
import { attachNetworkEvents, attachPuppeteerCapture } from './network.js';

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
      const events = attachNetworkEvents(page);
      const client = await page.target().createCDPSession();
      const captures = await attachPuppeteerCapture(client);
      return { raw: page, events, captures };
    },
    async close() {
      await browser.close();
    },
  };
}
