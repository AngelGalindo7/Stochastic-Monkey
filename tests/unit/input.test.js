import { describe, it, expect, vi } from 'vitest';
import { runInput } from '../../src/actions/input.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePage(handles) {
  return {
    engine: 'puppeteer',
    raw: { $$: vi.fn().mockResolvedValue(handles) },
  };
}

function typeableHandle() {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
  };
}

const DATA_POOL = ['hello', 'world', 'test@example.com'];

// ---------------------------------------------------------------------------
// Guard: target.name required
// ---------------------------------------------------------------------------

describe('runInput — target guard', () => {
  it('returns failure with latencyMs 0 when target is undefined', async () => {
    const page = makePage([]);
    const r = await runInput({ page, target: undefined, dataPool: DATA_POOL, rng: Math.random });
    expect(r.success).toBe(false);
    expect(r.error).toBe('no target');
    expect(r.latencyMs).toBe(0);
  });

  it('returns failure when target has no name property', async () => {
    const page = makePage([]);
    const r = await runInput({ page, target: {}, dataPool: DATA_POOL, rng: Math.random });
    expect(r.success).toBe(false);
    expect(r.error).toBe('no target');
  });
});

// ---------------------------------------------------------------------------
// No matching element
// ---------------------------------------------------------------------------

describe('runInput — no matching element', () => {
  it('returns failure when query returns no handles', async () => {
    const page = makePage([]);
    const r = await runInput({ page, target: { name: 'email' }, dataPool: DATA_POOL, rng: () => 0 });
    expect(r.success).toBe(false);
    expect(r.error).toBe('no matching input');
  });
});

// ---------------------------------------------------------------------------
// Successful input
// ---------------------------------------------------------------------------

describe('runInput — success', () => {
  it('returns { success: true, value, latencyMs }', async () => {
    const handle = typeableHandle();
    const page = makePage([handle]);
    const r = await runInput({ page, target: { name: 'email' }, dataPool: DATA_POOL, rng: () => 0 });
    expect(r.success).toBe(true);
    expect(r.value).toBe('hello');
    expect(typeof r.latencyMs).toBe('number');
  });

  it('selects value from dataPool using rng index', async () => {
    const handle = typeableHandle();
    const page = makePage([handle]);
    const r = await runInput({ page, target: { name: 'q' }, dataPool: DATA_POOL, rng: () => 0.5 });
    expect(r.value).toBe('world');
  });

  it('selects the last item when rng() is close to 1', async () => {
    const handle = typeableHandle();
    const page = makePage([handle]);
    const r = await runInput({ page, target: { name: 'q' }, dataPool: DATA_POOL, rng: () => 0.99 });
    expect(r.value).toBe('test@example.com');
  });

  it('triple-clicks to select all before typing', async () => {
    const handle = typeableHandle();
    const page = makePage([handle]);
    await runInput({ page, target: { name: 'q' }, dataPool: ['abc'], rng: () => 0 });
    expect(handle.click).toHaveBeenCalledWith({ clickCount: 3 });
  });

  it('types the selected value with delay: 20', async () => {
    const handle = typeableHandle();
    const page = makePage([handle]);
    await runInput({ page, target: { name: 'q' }, dataPool: ['myvalue'], rng: () => 0 });
    expect(handle.type).toHaveBeenCalledWith('myvalue', { delay: 20 });
  });

  it('coerces numeric dataPool values to string', async () => {
    const handle = typeableHandle();
    const page = makePage([handle]);
    await runInput({ page, target: { name: 'qty' }, dataPool: [42], rng: () => 0 });
    expect(handle.type).toHaveBeenCalledWith('42', { delay: 20 });
  });

  it('only uses the first matching handle', async () => {
    const h1 = typeableHandle();
    const h2 = typeableHandle();
    const page = makePage([h1, h2]);
    await runInput({ page, target: { name: 'email' }, dataPool: DATA_POOL, rng: () => 0 });
    expect(h1.type).toHaveBeenCalledTimes(1);
    expect(h2.type).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error recovery
// ---------------------------------------------------------------------------

describe('runInput — error recovery', () => {
  it('returns failure when handle.type throws', async () => {
    const handle = {
      click: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockRejectedValue(new Error('Input detached')),
    };
    const page = makePage([handle]);
    const r = await runInput({ page, target: { name: 'email' }, dataPool: DATA_POOL, rng: () => 0 });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Input detached');
  });

  it('returns failure when page.$$ throws', async () => {
    const page = { engine: 'puppeteer', raw: { $$: vi.fn().mockRejectedValue(new Error('Frame gone')) } };
    const r = await runInput({ page, target: { name: 'email' }, dataPool: DATA_POOL, rng: () => 0 });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Frame gone');
  });
});

// ---------------------------------------------------------------------------
// XPath shape passed to page.raw.$$
// ---------------------------------------------------------------------------

describe('runInput — xpath shape', () => {
  it('builds an xpath covering aria-label, placeholder, and name attributes', async () => {
    const page = makePage([]);
    await runInput({ page, target: { name: 'username' }, dataPool: DATA_POOL, rng: () => 0 });
    const xpathArg = page.raw.$$.mock.calls[0][0];
    expect(xpathArg).toMatch(/@aria-label='username'/);
    expect(xpathArg).toMatch(/@placeholder='username'/);
    expect(xpathArg).toMatch(/@name='username'/);
  });

  it('escapes single quotes in target.name to avoid malformed xpath', async () => {
    const page = makePage([]);
    await runInput({ page, target: { name: "user's email" }, dataPool: DATA_POOL, rng: () => 0 });
    const xpathArg = page.raw.$$.mock.calls[0][0];
    expect(xpathArg).toMatch(/@aria-label='user"s email'/);
    expect(xpathArg).not.toMatch(/@aria-label='user's email'/);
  });
});
