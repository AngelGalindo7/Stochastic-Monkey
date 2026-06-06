import { request as playwrightRequest } from 'playwright';

function tryParseJson(str) {
  if (!str || typeof str !== 'string') return null;
  try { return JSON.parse(str); } catch { return null; }
}

async function parseResponse(apiResponse) {
  const status = apiResponse.status();
  const contentType = apiResponse.headers()['content-type'] ?? '';
  const body = contentType.includes('application/json')
    ? tryParseJson(await apiResponse.text())
    : null;
  return { status, body };
}

export function sharedJarClient(page) {
  const ctx = page.context().request;

  return {
    async fetch(url, options = {}) {
      const response = await ctx.fetch(url, options);
      return parseResponse(response);
    },
  };
}

export async function isolatedClient(storageStatePath) {
  const contextOptions = storageStatePath ? { storageState: storageStatePath } : {};
  const ctx = await playwrightRequest.newContext(contextOptions);

  return {
    async fetch(url, options = {}) {
      const response = await ctx.fetch(url, options);
      return parseResponse(response);
    },
    async close() {
      await ctx.dispose();
    },
  };
}
