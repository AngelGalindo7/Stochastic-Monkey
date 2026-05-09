import { describe, it, expect } from 'vitest';
import { buildPredictPrompt, buildSurprisePrompt } from '../../src/llm/prompts.js';

const a11y = { role: 'main', children: [{ role: 'button', name: 'Submit' }] };
const action = { type: 'CLICK', target: { role: 'button', name: 'Submit' } };

describe('buildPredictPrompt', () => {
  it('omits history block when no recent actions', () => {
    const prompt = buildPredictPrompt({ a11yTree: a11y, action });
    expect(prompt).not.toMatch(/Recent actions/);
    expect(prompt).toMatch(/Proposed action: CLICK/);
  });

  it('includes recent actions block when provided', () => {
    const prompt = buildPredictPrompt({
      a11yTree: a11y,
      action,
      recentActions: [
        'step=0 NAVIGATION on "-"',
        'step=1 INPUT on "username"',
        'step=2 CLICK on "Sign in"',
      ],
    });
    expect(prompt).toMatch(/Recent actions taken/);
    expect(prompt).toMatch(/1\..*NAVIGATION/);
    expect(prompt).toMatch(/3\..*Sign in/);
  });

  it('keeps the proposed action and tree in the prompt regardless', () => {
    const prompt = buildPredictPrompt({
      a11yTree: a11y,
      action,
      recentActions: ['step=0 BACK on "-"'],
    });
    expect(prompt).toMatch(/"role":"button"/);
    expect(prompt).toMatch(/Proposed action: CLICK/);
  });
});

describe('buildSurprisePrompt', () => {
  it('always includes prediction and signals block', () => {
    const prompt = buildSurprisePrompt({
      prediction: 'page navigates',
      observed: a11y,
      hardSignals: ['HTTP_5XX'],
    });
    expect(prompt).toMatch(/Prediction: page navigates/);
    expect(prompt).toMatch(/HTTP_5XX/);
    expect(prompt).toMatch(/Reply with JSON/);
  });
});
