import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/llm/openai.js', () => ({
  complete: vi.fn(),
  llmAvailable: vi.fn(() => true),
}));

vi.mock('../../src/llm/gemini.js', () => ({
  complete: vi.fn(),
  llmAvailable: vi.fn(() => true),
}));

import { complete } from '../../src/llm/openai.js';
import { complete as completeGemini } from '../../src/llm/gemini.js';
import {
  predict,
  surprise,
  parseSurpriseJson,
  HARD_SIGNALS,
} from '../../src/agent/expectations.js';

const llmConfig = { enabled: true, model: 'gpt-4o-mini', maxTokens: 100, temperature: 0 };
const geminiConfig = { enabled: true, provider: 'gemini', model: 'gemini-2.0-flash-lite-001', maxTokens: 100, temperature: 0 };

describe('expectations.predict', () => {
  beforeEach(() => { complete.mockReset(); completeGemini.mockReset(); });

  it('skips LLM when disabled', async () => {
    const out = await predict({ a11yTree: {}, action: {}, llmConfig: { enabled: false } });
    expect(out).toMatch(/LLM disabled/);
    expect(complete).not.toHaveBeenCalled();
  });

  it('calls LLM when enabled', async () => {
    complete.mockResolvedValueOnce('Should load the next page.');
    const out = await predict({
      a11yTree: { role: 'main' },
      action: { type: 'CLICK', target: { role: 'button', name: 'Submit' } },
      llmConfig,
    });
    expect(out).toBe('Should load the next page.');
    expect(complete).toHaveBeenCalledOnce();
  });

  it('passes recentActions through to the prompt', async () => {
    complete.mockResolvedValueOnce('ok');
    await predict({
      a11yTree: { role: 'main' },
      action: { type: 'CLICK', target: { role: 'button', name: 'Submit' } },
      recentActions: ['step=0 INPUT on "user"', 'step=1 INPUT on "pass"'],
      llmConfig,
    });
    const sentPrompt = complete.mock.calls[0][0].prompt;
    expect(sentPrompt).toMatch(/Recent actions/);
    expect(sentPrompt).toMatch(/INPUT on "user"/);
  });
});

describe('expectations.surprise', () => {
  beforeEach(() => complete.mockReset());

  it('hard signal overrides to spec score', async () => {
    const out = await surprise({
      prediction: 'page loads',
      observed: { role: 'main' },
      hardSignals: ['HTTP_5XX'],
      llmConfig,
    });
    expect(out.score).toBe(HARD_SIGNALS.HTTP_5XX.score);
    expect(out.severity).toBe('critical');
    expect(out.hardSignalOverride).toBe(true);
    expect(out.signalType).toBe('HTTP_5XX');
    expect(complete).not.toHaveBeenCalled();
  });

  it('uses LLM JSON when no hard signal', async () => {
    complete.mockResolvedValueOnce('{"score": 0.7, "reason": "DOM diverged"}');
    const out = await surprise({
      prediction: 'page loads',
      observed: { role: 'main' },
      hardSignals: [],
      llmConfig,
    });
    expect(out.score).toBeCloseTo(0.7);
    expect(out.severity).toBe('medium');
    expect(out.hardSignalOverride).toBe(false);
  });

  it('returns 0 when LLM disabled and no hard signal', async () => {
    const out = await surprise({
      prediction: 'page loads',
      observed: {},
      hardSignals: [],
      llmConfig: { enabled: false },
    });
    expect(out.score).toBe(0);
  });

  it('picks the highest-score signal when multiple fire', async () => {
    const out = await surprise({
      prediction: 'page loads',
      observed: {},
      hardSignals: ['ASSET_4XX', 'HTTP_5XX', 'PERF_BREACH'],
      llmConfig,
    });
    expect(out.signalType).toBe('HTTP_5XX');
  });
});

describe('expectations with gemini provider', () => {
  beforeEach(() => { complete.mockReset(); completeGemini.mockReset(); });

  it('routes predict to gemini when provider=gemini', async () => {
    completeGemini.mockResolvedValueOnce('Page will submit the form.');
    const out = await predict({
      a11yTree: { role: 'main' },
      action: { type: 'CLICK', target: { role: 'button', name: 'Submit' } },
      llmConfig: geminiConfig,
    });
    expect(out).toBe('Page will submit the form.');
    expect(completeGemini).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it('routes surprise to gemini and parses JSON score', async () => {
    completeGemini.mockResolvedValueOnce('{"score": 0.85, "severity": "high", "reason": "form error appeared"}');
    const out = await surprise({
      prediction: 'page loads',
      observed: { role: 'main' },
      hardSignals: [],
      llmConfig: geminiConfig,
    });
    expect(out.score).toBeCloseTo(0.85);
    expect(out.severity).toBe('high');
    expect(out.reason).toBe('form error appeared');
    expect(out.hardSignalOverride).toBe(false);
    expect(completeGemini).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it('defaults to openai when provider is not set', async () => {
    complete.mockResolvedValueOnce('ok');
    await predict({
      a11yTree: { role: 'main' },
      action: { type: 'CLICK', target: { role: 'button', name: 'Go' } },
      llmConfig,
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(completeGemini).not.toHaveBeenCalled();
  });
});

describe('expectations.parseSurpriseJson', () => {
  it('parses clean JSON', () => {
    expect(parseSurpriseJson('{"score":0.5,"reason":"x"}')).toEqual({ score: 0.5, reason: 'x' });
  });
  it('clamps to [0,1]', () => {
    expect(parseSurpriseJson('{"score":2,"reason":""}').score).toBe(1);
    expect(parseSurpriseJson('{"score":-1,"reason":""}').score).toBe(0);
  });
  it('returns 0 for unparseable', () => {
    expect(parseSurpriseJson('garbage').score).toBe(0);
  });
});
