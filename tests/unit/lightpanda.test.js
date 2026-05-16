import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { launchLightpanda, NotImplementedError } from '../../src/browser/lightpanda.js';
import { snapshotPage, listInteractiveNodes } from '../../src/perception/a11yTree.js';

function createMockCDP(port) {
  const server = new WebSocketServer({ port });
  server.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      const { id, method, params } = msg;

      switch (method) {
        case 'Page.enable':
        case 'Network.enable':
        case 'Runtime.enable':
        case 'Accessibility.enable':
          ws.send(JSON.stringify({ id, result: {} }));
          break;

        case 'Page.navigate':
          ws.send(JSON.stringify({ id, result: { frameId: 'f1' } }));
          break;

        case 'Page.reload':
          ws.send(JSON.stringify({ id, result: {} }));
          break;

        case 'Runtime.evaluate':
          if (params.expression === 'document.readyState') {
            ws.send(JSON.stringify({ id, result: { result: { value: 'complete' } } }));
          } else if (params.expression === 'document.documentElement.outerHTML') {
            ws.send(JSON.stringify({
              id,
              result: { result: { value: '<html><body><h1>Hello</h1></body></html>' } },
            }));
          } else {
            ws.send(JSON.stringify({ id, result: { result: { value: null } } }));
          }
          break;

        case 'Page.captureScreenshot':
          ws.send(JSON.stringify({
            id,
            result: { data: Buffer.from('fake-png-data').toString('base64') },
          }));
          break;

        case 'Network.setCookie':
          ws.send(JSON.stringify({ id, result: { success: true } }));
          break;

        case 'Accessibility.getFullAXTree':
          ws.send(JSON.stringify({
            id,
            result: {
              nodes: [
                { nodeId: '1', role: { value: 'WebArea' }, name: { value: '' }, properties: [], childIds: ['2'] },
                { nodeId: '2', role: { value: 'heading' }, name: { value: 'Hello' }, properties: [], parentId: '1' },
              ],
            },
          }));
          break;

        case 'LP.getSemanticTree':
          ws.send(JSON.stringify({
            id,
            result: {
              tree: {
                role: 'WebArea',
                name: '',
                children: [
                  { role: 'heading', name: 'Hello' },
                  { role: 'link', name: 'Click me' },
                  { role: 'generic', name: '' },
                ],
              },
            },
          }));
          break;

        default:
          ws.send(JSON.stringify({ id, result: {} }));
      }
    });
  });
  return server;
}

describe('lightpanda CDP adapter', () => {
  let server;
  const PORT = 19222;

  beforeAll(() => {
    server = createMockCDP(PORT);
  });

  afterAll(() => {
    server.close();
  });

  it('throws NotImplementedError on Windows', async () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      await expect(launchLightpanda()).rejects.toThrow(NotImplementedError);
    } finally {
      Object.defineProperty(process, 'platform', { value: orig, configurable: true });
    }
  });

  it('throws NotImplementedError when CDP is unreachable', async () => {
    const prev = process.env.LIGHTPANDA_CDP_URL;
    process.env.LIGHTPANDA_CDP_URL = 'ws://127.0.0.1:19999';
    try {
      await expect(launchLightpanda()).rejects.toThrow(NotImplementedError);
    } finally {
      if (prev === undefined) delete process.env.LIGHTPANDA_CDP_URL;
      else process.env.LIGHTPANDA_CDP_URL = prev;
    }
  });

  it('connects and returns a browser with kind=lightpanda', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    expect(browser.kind).toBe('lightpanda');
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });

  it('newPage returns page with events array', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    const page = await browser.newPage();
    expect(Array.isArray(page.events)).toBe(true);
    expect(typeof page.raw.url).toBe('function');
    expect(typeof page.raw.goto).toBe('function');
    expect(typeof page.raw.screenshot).toBe('function');
    expect(typeof page.raw.content).toBe('function');
    expect(typeof page.raw.evaluate).toBe('function');
    expect(typeof page.raw.$$).toBe('function');
    expect(typeof page.raw.$$eval).toBe('function');
    expect(typeof page.raw.goBack).toBe('function');
    expect(typeof page.raw.goForward).toBe('function');
    expect(typeof page.raw.reload).toBe('function');
    expect(typeof page.raw.setCookie).toBe('function');
    expect(typeof page.raw.accessibility.snapshot).toBe('function');
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });

  it('page.goto navigates and updates url()', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    const page = await browser.newPage();
    await page.raw.goto('https://example.com');
    expect(page.raw.url()).toBe('https://example.com');
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });

  it('page.screenshot returns a Buffer', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    const page = await browser.newPage();
    await page.raw.goto('https://example.com');
    const buf = await page.raw.screenshot({ type: 'png' });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });

  it('page.content returns DOM HTML', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    const page = await browser.newPage();
    await page.raw.goto('https://example.com');
    const html = await page.raw.content();
    expect(html).toContain('<h1>Hello</h1>');
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });

  it('page.accessibility.snapshot returns a tree', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    const page = await browser.newPage();
    await page.raw.goto('https://example.com');
    const tree = await page.raw.accessibility.snapshot();
    expect(tree).toBeTruthy();
    expect(tree.role).toBe('WebArea');
    expect(tree.children).toBeTruthy();
    expect(tree.children[0].role).toBe('heading');
    expect(tree.children[0].name).toBe('Hello');
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });

  it('page.goBack returns null when no history', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    const page = await browser.newPage();
    const result = await page.raw.goBack();
    expect(result).toBeNull();
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });

  it('page.setCookie sends cookies via Network.setCookie', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    const page = await browser.newPage();
    await page.raw.setCookie({ name: 'sid', value: 'abc', domain: '.example.com' });
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });

  it('snapshotPage uses LP.getSemanticTree for Lightpanda pages', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    const page = await browser.newPage();
    await page.raw.goto('https://example.com');
    const tree = await snapshotPage(page.raw);
    expect(tree).toBeTruthy();
    expect(tree.role).toBe('WebArea');
    expect(tree.children.length).toBe(2);
    expect(tree.children[0].role).toBe('heading');
    expect(tree.children[0].name).toBe('Hello');
    expect(tree.children[1].role).toBe('link');
    expect(tree.children[1].name).toBe('Click me');
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });

  it('LP.getSemanticTree prunes layout-only nodes', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    const page = await browser.newPage();
    await page.raw.goto('https://example.com');
    const tree = await snapshotPage(page.raw);
    const names = tree.children.map((c) => c.role);
    expect(names).not.toContain('generic');
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });

  it('LP.getSemanticTree tree works with listInteractiveNodes', async () => {
    process.env.LIGHTPANDA_CDP_URL = `ws://127.0.0.1:${PORT}`;
    const browser = await launchLightpanda();
    const page = await browser.newPage();
    await page.raw.goto('https://example.com');
    const tree = await snapshotPage(page.raw);
    const interactive = listInteractiveNodes(tree);
    expect(interactive.length).toBe(1);
    expect(interactive[0].name).toBe('Click me');
    await browser.close();
    delete process.env.LIGHTPANDA_CDP_URL;
  });
});
