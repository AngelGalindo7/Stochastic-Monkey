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

/**
 * Creates an isolated Playwright request context for cross-identity oracle replays.
 * The context holds open a browser-level HTTP jar — callers MUST close it when done.
 *
 * @example
 * const client = await isolatedClient(storageStatePath);
 * try {
 *   const result = await client.fetch(url);
 * } finally {
 *   await client.close();
 * }
 */
export async function isolatedClient(storageStatePath) {
  const contextOptions = storageStatePath ? { storageState: storageStatePath } : {};
  const ctx = await playwrightRequest.newContext(contextOptions);
  let _disposed = false;

  return {
    async fetch(url, options = {}) {
      const response = await ctx.fetch(url, options);
      return parseResponse(response);
    },
    async close() {
      if (_disposed) return;
      _disposed = true;
      await ctx.dispose();
    },
  };
}
