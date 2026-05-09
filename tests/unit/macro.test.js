import { describe, it, expect, vi } from 'vitest';
import { runMacro } from '../../src/actions/macro.js';

vi.mock('../../src/actions/click.js', () => ({
  runClick: vi.fn(async ({ target }) => ({ success: !!target?.name, latencyMs: 1 })),
}));
vi.mock('../../src/actions/input.js', () => ({
  runInput: vi.fn(async ({ target, dataPool }) => ({
    success: !!target?.name,
    value: dataPool[0],
    latencyMs: 1,
  })),
}));
vi.mock('../../src/actions/history.js', () => ({
  runBack: vi.fn(async () => ({ success: true, latencyMs: 1 })),
  runForward: vi.fn(async () => ({ success: true, latencyMs: 1 })),
  runRefresh: vi.fn(async () => ({ success: true, latencyMs: 1 })),
}));
vi.mock('../../src/actions/scroll.js', () => ({
  runScroll: vi.fn(async () => ({ success: true, latencyMs: 1 })),
}));
vi.mock('../../src/actions/navigate.js', () => ({
  runNavigate: vi.fn(async () => ({ success: true, latencyMs: 1 })),
}));

const fakePage = { raw: { url: () => 'http://example.com' } };
const config = { actions: { dataPool: ['x'] }, target: { allowedDomains: ['example.com'] } };

describe('runMacro', () => {
  it('runs all steps and reports success', async () => {
    const macro = {
      name: 'test',
      steps: [
        { type: 'CLICK', target: 'Submit' },
        { type: 'BACK' },
        { type: 'REFRESH' },
      ],
    };
    const result = await runMacro({ macro, page: fakePage, config, rng: () => 0.5 });
    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(3);
    expect(result.stepResults.every((s) => s.success)).toBe(true);
  });

  it('aborts on a required-step failure', async () => {
    const macro = {
      name: 'abort',
      steps: [
        { type: 'CLICK' },
        { type: 'BACK' },
      ],
    };
    const result = await runMacro({ macro, page: fakePage, config, rng: () => 0.5 });
    expect(result.success).toBe(false);
    expect(result.stepResults).toHaveLength(1);
  });

  it('continues past a failure when required: false', async () => {
    const macro = {
      name: 'continue',
      steps: [
        { type: 'CLICK', required: false },
        { type: 'BACK' },
      ],
    };
    const result = await runMacro({ macro, page: fakePage, config, rng: () => 0.5 });
    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(2);
  });

  it('records breadcrumbs when supplied', async () => {
    const recorded = [];
    const breadcrumbs = { record: (type, summary) => recorded.push({ type, summary }) };
    const macro = {
      name: 'crumb',
      steps: [{ type: 'BACK' }, { type: 'FORWARD' }],
    };
    await runMacro({ macro, page: fakePage, config, rng: () => 0.5, breadcrumbs });
    expect(recorded).toHaveLength(2);
    expect(recorded[0].type).toBe('macro.step');
    expect(recorded[0].summary).toMatch(/\[crumb\].*BACK/);
  });

  it('rejects unknown step types but keeps going', async () => {
    const macro = {
      name: 'unknown',
      steps: [
        { type: 'NOPE', required: false },
        { type: 'BACK' },
      ],
    };
    const result = await runMacro({ macro, page: fakePage, config, rng: () => 0.5 });
    expect(result.stepResults[0].success).toBe(false);
    expect(result.stepResults[0].error).toMatch(/unknown step type/);
    expect(result.stepResults[1].success).toBe(true);
  });
});
