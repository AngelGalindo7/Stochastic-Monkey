import { launchPuppeteer } from './puppeteer.js';
import { launchLightpanda, NotImplementedError } from './lightpanda.js';

export async function createBrowser({ preferLightpanda = true, headful = false } = {}) {
  if (preferLightpanda && process.platform !== 'win32' && process.env.LIGHTPANDA_CDP_URL) {
    try {
      return await launchLightpanda({ headful });
    } catch (err) {
      if (err instanceof NotImplementedError) {
        console.warn(
          `[browser] lightpanda_unavailable (decision=${err.decision}): ${err.message}`,
        );
      } else {
        console.warn(`[browser] lightpanda launch failed: ${err.message}`);
      }
    }
  }
  return launchPuppeteer({ headful });
}
