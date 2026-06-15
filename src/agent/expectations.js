import { complete as completeOpenai } from '../llm/openai.js';
import { complete as completeGemini } from '../llm/gemini.js';
import { buildPredictPrompt } from '../llm/prompts.js';
import { scoreNovelty } from './novelty.js';

function complete(opts) {
  const provider = opts.provider ?? 'openai';
  if (provider === 'gemini') return completeGemini(opts);
  return completeOpenai(opts);
}

// The bug oracle. Each entry is a deterministic fault verdict. A `tier` separates
// two trust levels:
//   auto-assert     — near-always-right; fires a bug and may seed a generated test.
//   flag-for-review — credible but ambiguous; surfaced for a human, never auto-asserted.
// The LLM is NOT consulted for any of these (see DECISION_LOG: HTTP-code-driven
// detection). A missing `tier` defaults to auto-assert.
export const HARD_SIGNALS = {
  PAGEERROR: { score: 1.0, severity: 'high', tier: 'auto-assert' },
  HTTP_5XX: { score: 1.0, severity: 'critical', tier: 'auto-assert' },
  HTTP_4XX_NAV: { score: 0.8, severity: 'medium', tier: 'auto-assert' },
  ASSET_4XX: { score: 0.9, severity: 'medium', tier: 'auto-assert' },
  PERF_BREACH: { score: 0.6, severity: 'low', tier: 'auto-assert' },
  CONSOLE_ERROR: { score: 0.7, severity: 'medium', tier: 'auto-assert' },
  DOM_FROZEN: { score: 0.85, severity: 'medium', tier: 'auto-assert' },

  // Authorization-replay verdicts, emitted by the future replay oracle (the
  // recorder/replayer/orchestrator wiring lands separately). Split across the two
  // tiers because authz replay is heuristic: Autorize's own docs warn its
  // response-comparison fingerprints yield both false positives and false negatives,
  // so it cannot share the auto-assert tier wholesale (adversarial finding A1/A3).
  //   CROSS_ACCOUNT_LEAK is auto-assert ONLY because the oracle fires it solely when
  //   role B's 200 still carries role A's owned sensitive fields after field-level
  //   body scrubbing — an unambiguous data diff, not a status-only guess.
  //   AUTHZ_UNCERTAIN is the flag-for-review bucket for every ambiguous case the spec
  //   enumerates (signed / capability-URL routing, un-refreshable per-request nonce, a
  //   CSRF refresh that could explain the 200, infra 403/429 vs authz 403). Its score
  //   sits below every auto-assert signal so a co-firing real signal always wins
  //   selection, and it never auto-generates a test.
  CROSS_ACCOUNT_LEAK: { score: 1.0, severity: 'critical', tier: 'auto-assert' },
  AUTHZ_UNCERTAIN: { score: 0.5, severity: 'low', tier: 'flag-for-review' },
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
    const tier = hard.spec.tier ?? 'auto-assert';
    const autoAssert = tier === 'auto-assert';
    return {
      score: hard.spec.score,
      severity: hard.spec.severity,
      // auto-assert fires a real bug; flag-for-review is surfaced for a human and
      // must never auto-assert a bug or seed a generated test (adversarial A1/A3).
      isBug: autoAssert,
      needsReview: !autoAssert,
      tier,
      hardSignalOverride: true,
      signalType: hard.type,
      reason: `${autoAssert ? 'hard signal' : 'flag-for-review'}: ${hard.type}`,
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
    needsReview: false,
    tier: null,
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
