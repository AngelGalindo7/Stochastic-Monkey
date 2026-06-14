import { complete as completeOpenai } from '../llm/openai.js';
import { complete as completeGemini } from '../llm/gemini.js';
import { buildPredictPrompt } from '../llm/prompts.js';
import { scoreNovelty } from './novelty.js';

function complete(opts) {
  const provider = opts.provider ?? 'openai';
  if (provider === 'gemini') return completeGemini(opts);
  return completeOpenai(opts);
}

// The bug oracle. Each entry is a deterministic, unambiguous fault — primarily
// HTTP status codes plus uncaught page errors. When any of these fire, the step
// is a bug regardless of how "novel" the resulting state looks. The LLM is NOT
// consulted for this verdict (see DECISION_LOG: HTTP-code-driven detection).
export const HARD_SIGNALS = {
  PAGEERROR: { score: 1.0, severity: 'high' },
  HTTP_5XX: { score: 1.0, severity: 'critical' },
  HTTP_4XX_NAV: { score: 0.8, severity: 'medium' },
  ASSET_4XX: { score: 0.9, severity: 'medium' },
  PERF_BREACH: { score: 0.6, severity: 'low' },
  CONSOLE_ERROR: { score: 0.7, severity: 'medium' },
  DOM_FROZEN: { score: 0.85, severity: 'medium' },
};

// LLM-backed prediction of an action's expected outcome. No longer called from
// the per-step hot loop (detection is deterministic) — retained for the future
// test-synthesis stage, where the LLM proposes test code rather than verdicts.
export async function predict({ a11yTree, action, recentActions = [], llmConfig }) {
  if (!llmConfig?.enabled) return 'LLM disabled — hard signals only.';
  const prompt = buildPredictPrompt({ a11yTree, action, recentActions });
  return complete({
    prompt,
    model: llmConfig.model,
    maxTokens: llmConfig.maxTokens ?? 200,
    temperature: llmConfig.temperature ?? 0.4,
    provider: llmConfig.provider,
  });
}

// Score a single step. Two separate questions, never conflated:
//   isBug  — owned by hard signals (HTTP codes / pageerror). Deterministic.
//   score  — exploration novelty for MCTS backprop. Never declares a bug.
export function scoreState({
  observed,
  prevA11y = null,
  currentUrl = null,
  prevUrl = null,
  hardSignals = [],
  recentStateIds = [],
  currentStateId = null,
  lowSignalExtra = [],
}) {
  const hard = highestHardSignal(hardSignals);
  if (hard) {
    return {
      score: hard.spec.score,
      severity: hard.spec.severity,
      isBug: true,
      hardSignalOverride: true,
      signalType: hard.type,
      reason: `hard signal: ${hard.type}`,
    };
  }

  const nov = scoreNovelty({
    prevA11y,
    currA11y: observed,
    prevUrl,
    currUrl: currentUrl,
    currentStateId,
    recentStateIds,
    lowSignalExtra,
  });
  return {
    score: nov.score,
    severity: 'info',
    isBug: false,
    hardSignalOverride: false,
    signalType: null,
    reason: nov.reason,
  };
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
