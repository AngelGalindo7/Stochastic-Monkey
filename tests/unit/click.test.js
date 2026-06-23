import { describe, it, expect, vi } from 'vitest';
import { runClick } from '../../src/actions/click.js';

// ---------------------------------------------------------------------------
// Helpers — mock page that satisfies queryByXPath via page.raw.$$
// ---------------------------------------------------------------------------

function makePage(handles) {
  return {
    engine: 'puppeteer',
    raw: { $$: vi.fn().mockResolvedValue(handles) },
  };
}

function clickableHandle(opts = {}) {
  return { click: vi.fn().mockResolvedValue(undefined), ...opts };
}

// ---------------------------------------------------------------------------
// Guard: target.name required
// ---------------------------------------------------------------------------

describe('runClick — target guard', () => {
  it('returns failure with latencyMs 0 when target is undefined', async () => {
    const page = makePage([]);
    const r = await runClick({ page, target: undefined });
    expect(r.success).toBe(false);
    expect(r.error).toBe('no target name');
    expect(r.latencyMs).toBe(0);
  });

  it('returns failure when target has no name property', async () => {
    const page = makePage([]);
    const r = await runClick({ page, target: { role: 'button' } });
    expect(r.success).toBe(false);
    expect(r.error).toBe('no target name');
  });

  it('returns failure when target.name is empty string', async () => {
    const page = makePage([]);
    const r = await runClick({ page, target: { role: 'button', name: '' } });
    expect(r.success).toBe(false);
    expect(r.error).toBe('no target name');
  });
});

// ---------------------------------------------------------------------------
// No matching element
// ---------------------------------------------------------------------------

describe('runClick — no matching element', () => {
  it('returns failure when query returns no handles', async () => {
    const page = makePage([]);
    const r = await runClick({ page, target: { role: 'button', name: 'Submit' } });
    expect(r.success).toBe(false);
    expect(r.error).toBe('no matching element');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Successful click
// ---------------------------------------------------------------------------

describe('runClick — success', () => {
  it('returns { success: true, latencyMs } on a successful click', async () => {
    const handle = clickableHandle();
    const page = makePage([handle]);
    const r = await runClick({ page, target: { role: 'button', name: 'Submit' } });
    expect(r.success).toBe(true);
    expect(typeof r.latencyMs).toBe('number');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('calls click on the first handle only', async () => {
    const h1 = clickableHandle();
    const h2 = clickableHandle();
    const page = makePage([h1, h2]);
    await runClick({ page, target: { role: 'button', name: 'Submit' } });
    expect(h1.click).toHaveBeenCalledTimes(1);
    expect(h2.click).not.toHaveBeenCalled();
  });

  it('calls click with delay: 30', async () => {
    const handle = clickableHandle();
    const page = makePage([handle]);
    await runClick({ page, target: { role: 'button', name: 'Submit' } });
    expect(handle.click).toHaveBeenCalledWith({ delay: 30 });
  });
});

// ---------------------------------------------------------------------------
// Click throws
// ---------------------------------------------------------------------------

describe('runClick — error recovery', () => {
  it('returns failure with the error message when click throws', async () => {
    const handle = { click: vi.fn().mockRejectedValue(new Error('Element detached')) };
    const page = makePage([handle]);
    const r = await runClick({ page, target: { role: 'button', name: 'Submit' } });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Element detached');
  });

  it('returns failure when page.$$ throws', async () => {
    const page = { engine: 'puppeteer', raw: { $$: vi.fn().mockRejectedValue(new Error('Frame detached')) } };
    const r = await runClick({ page, target: { role: 'button', name: 'Submit' } });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Frame detached');
  });
});

// ---------------------------------------------------------------------------
// buildXpathByName — xpath shape passed to page.raw.$$
// ---------------------------------------------------------------------------

describe('runClick — buildXpathByName', () => {
  it('uses //a[normalize-space(.)=...] for role link', async () => {
    const page = makePage([]);
    await runClick({ page, target: { role: 'link', name: 'Home' } });
    const xpathArg = page.raw.$$.mock.calls[0][0];
    expect(xpathArg).toMatch(/^xpath\/\.\s*\/\/a\[normalize-space/);
    expect(xpathArg).toMatch(/'Home'/);
  });

  it('uses //button[normalize-space(.)=...] for role button', async () => {
    const page = makePage([]);
    await runClick({ page, target: { role: 'button', name: 'Save' } });
    const xpathArg = page.raw.$$.mock.calls[0][0];
    expect(xpathArg).toMatch(/\/\/button\[normalize-space/);
    expect(xpathArg).toMatch(/'Save'/);
  });

  it('uses //*[@role=...] for any other role', async () => {
    const page = makePage([]);
    await runClick({ page, target: { role: 'menuitem', name: 'Settings' } });
    const xpathArg = page.raw.$$.mock.calls[0][0];
    expect(xpathArg).toMatch(/@role='menuitem'/);
    expect(xpathArg).toMatch(/'Settings'/);
  });

  it('escapes single quotes in name: apostrophe becomes double-quote', async () => {
    const page = makePage([]);
    await runClick({ page, target: { role: 'button', name: "Don't click" } });
    const xpathArg = page.raw.$$.mock.calls[0][0];
    // replace(/'/g, '"') turns "Don't" into 'Don"t'; the xpath delimiter stays '...'
    expect(xpathArg).toMatch(/'Don"t click'/);
  });
});
