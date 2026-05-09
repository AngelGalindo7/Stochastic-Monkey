import { complete } from '../llm/openai.js';
import { buildPredictPrompt, buildSurprisePrompt } from '../llm/prompts.js';

export const HARD_SIGNALS = {
  PAGEERROR: { score: 1.0, severity: 'high' },
  HTTP_5XX: { score: 1.0, severity: 'critical' },
  ASSET_4XX: { score: 0.9, severity: 'medium' },
  PERF_BREACH: { score: 0.6, severity: 'low' },
  DOM_FROZEN: { score: 0.85, severity: 'medium' },
};

export async function predict({ a11yTree, action, recentActions = [], llmConfig }) {
  if (!llmConfig?.enabled) return 'LLM disabled — hard signals only.';
  const prompt = buildPredictPrompt({ a11yTree, action, recentActions });
  return complete({
    prompt,
    model: llmConfig.model,
    maxTokens: llmConfig.maxTokens ?? 200,
    temperature: llmConfig.temperature ?? 0.4,
  });
}

export async function surprise({ prediction, observed, hardSignals = [], llmConfig }) {
  const hard = highestHardSignal(hardSignals);
  if (hard) {
    return {
      score: hard.spec.score,
      severity: hard.spec.severity,
      hardSignalOverride: true,
      signalType: hard.type,
      reason: `hard signal: ${hard.type}`,
    };
  }
  if (!llmConfig?.enabled) {
    return {
      score: 0,
      severity: 'low',
      hardSignalOverride: false,
      signalType: null,
      reason: 'no hard signal, LLM disabled',
    };
  }
  const prompt = buildSurprisePrompt({ prediction, observed, hardSignals });
  const raw = await complete({
    prompt,
    model: llmConfig.model,
    maxTokens: 120,
    temperature: 0,
  });
  const parsed = parseSurpriseJson(raw);
  return {
    score: parsed.score,
    severity: scoreToSeverity(parsed.score),
    hardSignalOverride: false,
    signalType: null,
    reason: parsed.reason,
  };
}

export function parseSurpriseJson(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { score: 0, reason: 'unparsable LLM response' };
  try {
    const obj = JSON.parse(match[0]);
    const score = clamp01(Number(obj.score));
    return { score, reason: obj.reason ?? '' };
  } catch {
    return { score: 0, reason: 'invalid LLM JSON' };
  }
}

function highestHardSignal(signals) {
  let best = null;
  for (const s of signals) {
    const spec = HARD_SIGNALS[s];
    if (!spec) continue;
    if (!best || spec.score > best.spec.score) best = { type: s, spec };
  }
  return best;
}

function scoreToSeverity(score) {
  if (score >= 0.85) return 'high';
  if (score >= 0.6) return 'medium';
  if (score >= 0.3) return 'low';
  return 'low';
}

function clamp01(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
