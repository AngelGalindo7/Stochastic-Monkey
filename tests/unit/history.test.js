import { describe, it, expect, vi } from 'vitest';
import { runBack, runForward, runRefresh } from '../../src/actions/history.js';

function fakePage(handlers = {}) {
  return {
    raw: {
      goBack: handlers.goBack ?? vi.fn(async () => ({})),
      goForward: handlers.goForward ?? vi.fn(async () => ({})),
      reload: handlers.reload ?? vi.fn(async () => ({})),
    },
  };
}

describe('history actions', () => {
  it('runBack succeeds when goBack returns a response', async () => {
    const page = fakePage();
    const r = await runBack({ page });
    expect(r.success).toBe(true);
  });

  it('runBack fails when goBack returns null (no history)', async () => {
    const page = fakePage({ goBack: vi.fn(async () => null) });
    const r = await runBack({ page });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no history/);
  });

  it('runForward fails when goForward returns null', async () => {
    const page = fakePage({ goForward: vi.fn(async () => null) });
    const r = await runForward({ page });
    expect(r.success).toBe(false);
  });

  it('runRefresh succeeds on reload', async () => {
    const page = fakePage();
    const r = await runRefresh({ page });
    expect(r.success).toBe(true);
  });

  it('runBack catches thrown errors', async () => {
    const page = fakePage({ goBack: vi.fn(async () => { throw new Error('timeout'); }) });
    const r = await runBack({ page });
    expect(r.success).toBe(false);
    expect(r.error).toBe('timeout');
  });
});
