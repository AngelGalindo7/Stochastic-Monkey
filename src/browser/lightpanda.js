import { WebSocket } from 'ws';

export class NotImplementedError extends Error {
  constructor(message, decision) {
    super(message);
    this.name = 'NotImplementedError';
    this.decision = decision;
  }
}

class CDPSession {
  #ws;
  #nextId = 1;
  #pending = new Map();
  #eventHandlers = new Map();

  static async connect(url, timeout = 10000) {
    const session = new CDPSession();
    await session.#open(url, timeout);
    return session;
  }

  #open(url, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`CDP connect timeout after ${timeout}ms to ${url}`));
      }, timeout);
      this.#ws = new WebSocket(url);
      this.#ws.on('open', () => {
        clearTimeout(timer);
        resolve();
      });
      this.#ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      this.#ws.on('message', (data) => this.#onMessage(data));
    });
  }

  #onMessage(data) {
    const msg = JSON.parse(data);
    if (msg.id != null && this.#pending.has(msg.id)) {
      const { resolve, reject } = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      const handlers = this.#eventHandlers.get(msg.method);
      if (handlers) handlers.forEach((fn) => fn(msg.params));
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, handler) {
    if (!this.#eventHandlers.has(event)) this.#eventHandlers.set(event, []);
    this.#eventHandlers.get(event).push(handler);
  }

  close() {
    if (this.#ws) this.#ws.close();
  }
}

class LightpandaPage {
  #cdp;
  #currentUrl = '';
  #history = [];
  #historyIndex = -1;

  constructor(cdp) {
    this.#cdp = cdp;
    this.accessibility = { snapshot: (opts) => this.#a11ySnapshot(opts) };
  }

  url() {
    return this.#currentUrl;
  }

  async goto(url, opts = {}) {
    const timeout = opts.timeout ?? 15000;
    const result = await Promise.race([
      this.#cdp.send('Page.navigate', { url }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`goto timeout: ${url}`)), timeout),
      ),
    ]);
    if (result?.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
    await this.#waitForLoad(timeout);
    this.#currentUrl = url;
    this.#history.splice(this.#historyIndex + 1);
    this.#history.push(url);
    this.#historyIndex = this.#history.length - 1;
    return result;
  }

  async screenshot(opts = {}) {
    const params = { format: opts.type === 'jpeg' ? 'jpeg' : 'png' };
    if (opts.fullPage) params.captureBeyondViewport = true;
    const { data } = await this.#cdp.send('Page.captureScreenshot', params);
    return Buffer.from(data, 'base64');
  }

  async content() {
    const { result } = await this.#cdp.send('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      returnByValue: true,
    });
    return result.value ?? '';
  }

  async evaluate(fnOrString, ...args) {
    let expression;
    if (typeof fnOrString === 'function') {
      expression = `(${fnOrString.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;
    } else {
      expression = fnOrString;
    }
    const { result, exceptionDetails } = await this.#cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate error');
    return result.value;
  }

  async $$(selector) {
    const isXpath = selector.startsWith('xpath/');
    const expr = isXpath ? selector.slice('xpath/'.length) : selector;

    const jsExpr = isXpath
      ? `(() => {
          const result = [];
          const snap = document.evaluate(${JSON.stringify(expr)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < snap.snapshotLength; i++) result.push(snap.snapshotItem(i));
          return result.length;
        })()`
      : `document.querySelectorAll(${JSON.stringify(expr)}).length`;

    const count = await this.evaluate(jsExpr);
    const handles = [];
    for (let i = 0; i < count; i++) {
      handles.push(new LightpandaElementHandle(this.#cdp, this, isXpath ? expr : selector, i, isXpath));
    }
    return handles;
  }

  async $$eval(selector, pageFn, ...args) {
    const fnStr = pageFn.toString();
    const argsStr = args.map((a) => JSON.stringify(a)).join(',');
    const expression = `(() => {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const fn = ${fnStr};
      return fn(els${argsStr ? ', ' + argsStr : ''});
    })()`;
    return this.evaluate(expression);
  }

  async goBack(opts = {}) {
    if (this.#historyIndex <= 0) return null;
    this.#historyIndex--;
    const url = this.#history[this.#historyIndex];
    await this.#cdp.send('Page.navigate', { url });
    await this.#waitForLoad(opts.timeout ?? 8000);
    this.#currentUrl = url;
    return {};
  }

  async goForward(opts = {}) {
    if (this.#historyIndex >= this.#history.length - 1) return null;
    this.#historyIndex++;
    const url = this.#history[this.#historyIndex];
    await this.#cdp.send('Page.navigate', { url });
    await this.#waitForLoad(opts.timeout ?? 8000);
    this.#currentUrl = url;
    return {};
  }

  async reload(opts = {}) {
    await this.#cdp.send('Page.reload');
    await this.#waitForLoad(opts.timeout ?? 8000);
  }

  async setCookie(...cookies) {
    for (const cookie of cookies) {
      await this.#cdp.send('Network.setCookie', cookie);
    }
  }

  async #a11ySnapshot(_opts = {}) {
    const { nodes } = await this.#cdp.send('Accessibility.getFullAXTree');
    return buildA11yTree(nodes);
  }

  async #waitForLoad(timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const { result } = await this.#cdp.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      if (result.value === 'complete' || result.value === 'interactive') return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

class LightpandaElementHandle {
  #cdp;
  #page;
  #selector;
  #index;
  #isXpath;

  constructor(cdp, page, selector, index, isXpath) {
    this.#cdp = cdp;
    this.#page = page;
    this.#selector = selector;
    this.#index = index;
    this.#isXpath = isXpath;
  }

  async click(opts = {}) {
    const delay = opts.delay ?? 0;
    const clickCount = opts.clickCount ?? 1;
    const expr = this.#isXpath
      ? `(() => {
          const snap = document.evaluate(${JSON.stringify(this.#selector)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          const el = snap.snapshotItem(${this.#index});
          if (el) el.click();
          return !!el;
        })()`
      : `(() => {
          const el = document.querySelectorAll(${JSON.stringify(this.#selector)})[${this.#index}];
          if (el) el.click();
          return !!el;
        })()`;

    for (let i = 0; i < clickCount; i++) {
      const found = await this.#page.evaluate(expr);
      if (!found) throw new Error(`Element not found: ${this.#selector}[${this.#index}]`);
      if (delay && i < clickCount - 1) await new Promise((r) => setTimeout(r, delay));
    }
  }

  async type(text, opts = {}) {
    const delay = opts.delay ?? 0;
    const focusExpr = this.#isXpath
      ? `(() => {
          const snap = document.evaluate(${JSON.stringify(this.#selector)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          const el = snap.snapshotItem(${this.#index});
          if (el) { el.focus(); el.value = ''; }
          return !!el;
        })()`
      : `(() => {
          const el = document.querySelectorAll(${JSON.stringify(this.#selector)})[${this.#index}];
          if (el) { el.focus(); el.value = ''; }
          return !!el;
        })()`;

    const found = await this.#page.evaluate(focusExpr);
    if (!found) throw new Error(`Element not found for type: ${this.#selector}[${this.#index}]`);

    for (const char of text) {
      await this.#cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char,
        key: char,
      });
      await this.#cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: char,
      });
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }

    const setValueExpr = this.#isXpath
      ? `(() => {
          const snap = document.evaluate(${JSON.stringify(this.#selector)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          const el = snap.snapshotItem(${this.#index});
          if (el) el.value = ${JSON.stringify(text)};
        })()`
      : `(() => {
          const el = document.querySelectorAll(${JSON.stringify(this.#selector)})[${this.#index}];
          if (el) el.value = ${JSON.stringify(text)};
        })()`;
    await this.#page.evaluate(setValueExpr);
  }
}

function buildA11yTree(nodes) {
  if (!nodes || nodes.length === 0) return null;

  const map = new Map();
  for (const node of nodes) {
    const entry = {
      role: propValue(node, 'role') ?? node.role?.value ?? 'generic',
      name: propValue(node, 'name') ?? node.name?.value ?? '',
    };
    const val = propValue(node, 'value');
    if (val) entry.value = val;
    entry.children = [];
    map.set(node.nodeId, entry);
  }

  let root = null;
  for (const node of nodes) {
    const entry = map.get(node.nodeId);
    if (node.childIds?.length) {
      for (const childId of node.childIds) {
        const child = map.get(childId);
        if (child) entry.children.push(child);
      }
    }
    if (node.parentId == null || !map.has(node.parentId)) {
      root = entry;
    }
  }

  for (const entry of map.values()) {
    if (entry.children.length === 0) delete entry.children;
  }

  return root;
}

function propValue(node, name) {
  const prop = node.properties?.find((p) => p.name === name);
  return prop?.value?.value ?? null;
}

export async function launchLightpanda(_opts = {}) {
  if (process.platform === 'win32') {
    throw new NotImplementedError(
      'Lightpanda has no native Windows build (DECISION_LOG 002).',
      '002',
    );
  }

  const cdpUrl = process.env.LIGHTPANDA_CDP_URL ?? 'ws://127.0.0.1:9222';

  let cdp;
  try {
    cdp = await CDPSession.connect(cdpUrl);
  } catch (err) {
    throw new NotImplementedError(
      `Cannot connect to Lightpanda CDP at ${cdpUrl}: ${err.message}`,
      '002',
    );
  }

  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Accessibility.enable').catch(() => {});

  return {
    kind: 'lightpanda',
    raw: cdp,
    async newPage() {
      const page = new LightpandaPage(cdp);
      const events = [];

      cdp.on('Runtime.exceptionThrown', (params) => {
        events.push({
          type: 'PAGEERROR',
          message: params.exceptionDetails?.text ?? 'unknown error',
          stack: params.exceptionDetails?.exception?.description ?? '',
        });
      });

      cdp.on('Runtime.consoleAPICalled', (params) => {
        if (params.type === 'error') {
          const text = params.args?.map((a) => a.value ?? a.description ?? '').join(' ') ?? '';
          events.push({ type: 'CONSOLE_ERROR', message: text });
        }
      });

      cdp.on('Network.responseReceived', (params) => {
        const status = params.response?.status;
        const url = params.response?.url ?? '';
        if (status >= 500) events.push({ type: 'HTTP_5XX', url, status });
        else if (status >= 400) events.push({ type: 'HTTP_4XX', url, status });
      });

      cdp.on('Network.loadingFailed', (params) => {
        events.push({
          type: 'REQUEST_FAILED',
          url: params.request?.url ?? '',
          reason: params.errorText ?? 'unknown',
        });
      });

      return { raw: page, events };
    },
    async close() {
      cdp.close();
    },
  };
}
