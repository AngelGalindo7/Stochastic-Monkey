import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockContexts = [];

function makeCtx() {
  const jar = [];
  return {
    newPage: vi.fn(async () => ({})),
    addCookies: vi.fn(async (cs) => jar.push(...cs)),
    cookies: vi.fn(async () => [...jar]),
    newCDPSession: vi.fn(async () => ({
      send: vi.fn(async (m) =>
        m === 'Accessibility.getFullAXTree' ? { nodes: [] } : {},
      ),
    })),
    close: vi.fn(async () => {}),
    _jar: jar,
  };
}

vi.mock('playwright', () => {
  const browser = {
    newContext: vi.fn(async () => {
      const ctx = makeCtx();
      mockContexts.push(ctx);
      return ctx;
    }),
    close: vi.fn(async () => {}),
  };
  return {
    chromium: {
      launch: vi.fn(async () => browser),
      launchPersistentContext: vi.fn(async () => {
        const ctx = makeCtx();
        mockContexts.push(ctx);
        return ctx;
      }),
    },
  };
});

vi.mock('../../src/browser/network.js', () => ({
  attachNetworkEvents: vi.fn(() => []),
  attachPlaywrightCapture: vi.fn(() => []),
}));

import { chromium } from 'playwright';
import { launchPlaywright } from '../../src/browser/playwright.js';

beforeEach(() => {
  mockContexts = [];
  vi.clearAllMocks();
  chromium.launch.mockImplementation(async () => ({
    newContext: vi.fn(async () => {
      const ctx = makeCtx();
      mockContexts.push(ctx);
      return ctx;
    }),
    close: vi.fn(async () => {}),
  }));
});

// Regression: without per-role isolation a shared context bleeds Set-Cookie
// values from the user session into the admin session mid-run, making authz
// tests silently check the wrong identity.
describe('launchPlaywright — per-role BrowserContext isolation', () => {
  it('user and admin roles get separate BrowserContext objects', async () => {
    const b = await launchPlaywright({});
    await b.newPage('user');
    await b.newPage('admin');
    expect(mockContexts).toHaveLength(2);
    expect(mockContexts[0]).not.toBe(mockContexts[1]);
    await b.close();
  });

  it('same role called twice reuses the cached context', async () => {
    const b = await launchPlaywright({});
    await b.newPage('user');
    await b.newPage('user');
    expect(mockContexts).toHaveLength(1);
    await b.close();
  });

  it('cookie seeded in user role does not appear in admin role', async () => {
    const b = await launchPlaywright({});
    const userPage = await b.newPage('user');
    const adminPage = await b.newPage('admin');

    await userPage.raw.setCookie({ name: 'tok', value: 'secret', domain: 'example.com' });

    const adminCookies = await adminPage.raw.cookies();
    expect(adminCookies).toHaveLength(0);
    await b.close();
  });

});

// Regression: callers that pass storageState (the legacy single-context path)
// must continue to work unchanged — storageState is normalized into roles
// internally, and the resulting context must be launched with the given path.
describe('launchPlaywright — storageState backward-compat', () => {
  it('context created with the given storageState when passed as top-level option', async () => {
    let capturedOpts = null;
    chromium.launch.mockImplementation(async () => ({
      newContext: vi.fn(async (opts) => {
        capturedOpts = opts;
        const ctx = makeCtx();
        mockContexts.push(ctx);
        return ctx;
      }),
      close: vi.fn(async () => {}),
    }));

    const b = await launchPlaywright({ storageState: '/tmp/auth.json' });
    await b.newPage('user');
    expect(capturedOpts).toEqual(expect.objectContaining({ storageState: '/tmp/auth.json' }));
    await b.close();
  });
});

// Regression: if browser.close() or any ctx.close() is accidentally removed,
// the browser process leaks and file descriptors accumulate across the run.
describe('launchPlaywright — close() cleanup', () => {
  it('close() shuts all created contexts and the underlying browser', async () => {
    let mockBrowser;
    chromium.launch.mockImplementation(async () => {
      mockBrowser = {
        newContext: vi.fn(async () => {
          const ctx = makeCtx();
          mockContexts.push(ctx);
          return ctx;
        }),
        close: vi.fn(async () => {}),
      };
      return mockBrowser;
    });

    const b = await launchPlaywright({});
    await b.newPage('user');
    await b.newPage('admin');
    expect(mockContexts).toHaveLength(2);
    await b.close();
    for (const ctx of mockContexts) {
      expect(ctx.close).toHaveBeenCalledOnce();
    }
    expect(mockBrowser.close).toHaveBeenCalledOnce();
  });
});
