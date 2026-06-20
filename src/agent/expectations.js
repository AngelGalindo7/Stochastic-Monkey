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
// detection). HTTP_500 covers 500-class 5xx (500/501/502/505+); HTTP_503_504 covers
// 503/504 as flag-for-review — see DECISION_LOG 006.
export const HARD_SIGNALS = {
  PAGEERROR: { score: 1.0, severity: 'high', tier: 'auto-assert' },
  HTTP_500: { score: 1.0, severity: 'critical', tier: 'auto-assert' },
  HTTP_503_504: { score: 0.5, severity: 'low', tier: 'flag-for-review' },
  // Demoted to flag-for-review (DECISION_LOG 013): SPA client-routing makes a
  // server-side document 4xx near-blind, and the cases it does catch (framework route
  // prefetch, intentional styled 404 pages) are often correct behaviour — too
  // ambiguous to auto-assert.
  HTTP_4XX_NAV: { score: 0.5, severity: 'medium', tier: 'flag-for-review' },
  ASSET_4XX: { score: 0.9, severity: 'medium', tier: 'auto-assert' },
  // PERF_BREACH decommissioned (DECISION_LOG 013): per-action wall-clock latency is
  // environment noise, not reproducible across machines, and never indicated a real bug.
  // first-party but app-intentional patterns (error boundaries, fetch guards) are indistinguishable from crashes.
  CONSOLE_ERROR: { score: 0.7, severity: 'medium', tier: 'flag-for-review' },
  // Demoted to flag-for-review (DECISION_LOG 013): a fixed-delay empty-DOM check
  // false-fires on slow SPA hydration and legitimately-empty states; a genuine
  // crash-to-blank-screen is already auto-asserted via the co-firing PAGEERROR/
  // CONSOLE_ERROR, so nothing real is lost by not auto-asserting the bare blank.
  DOM_FROZEN: { score: 0.5, severity: 'medium', tier: 'flag-for-review' },
  // Image with HTTP 200 but naturalWidth === 0 after decode — the silent gap ASSET_4XX misses.
  // Scored low because onerror placeholder-swap bypasses detection in most production apps.
  BROKEN_IMAGE: { score: 0.35, severity: 'low', tier: 'flag-for-review' },

  // B2 cross-layer persisted-state verdicts, emitted by crossLayer.js after
  // a committed mutation (2xx, not 202). Auto-assert because the oracle only fires
  // when the gone-set / existence check is unambiguous after N polling retries
  // (adversarial report: "cross-layer differential where the contract is unambiguous").
  STATE_NOT_DELETED: { score: 1.0, severity: 'critical', tier: 'auto-assert' },
  STATE_NOT_PERSISTED: { score: 1.0, severity: 'critical', tier: 'auto-assert' },
  // Content-diff verdict: a PUT/PATCH was committed (2xx) and the resource
  // persists, but the verify GET returned different values for the written fields.
  // flag-for-review (not auto-assert) because server-side normalization — trimming,
  // lowercasing, timestamps — can legitimately alter string representations.
  STATE_WRONG_VALUE: { score: 0.6, severity: 'medium', tier: 'flag-for-review' },

  // Authorization-replay verdicts, emitted by the post-run authz oracle. Both are
  // flag-for-review because authz replay is heuristic: Autorize's own docs warn its
  // response-comparison fingerprints yield both false positives and false negatives,
  // so it cannot share the auto-assert tier (adversarial finding A1/A3).
  //   CROSS_ACCOUNT_LEAK is flag-for-review for two reasons. (1) Wiring: the check runs
  //   in main() outside runArm and routes its result through writeFlaggedReport
  //   (FLAGGED/) unconditionally — it never reaches scoreState / writeBugReport, so any
  //   auto-assert tier here is dead metadata. (2) Contract: even a sentinel-grounded
  //   leak can be a false positive — if the monkey filled an intentionally-public form
  //   (a public comment/review), an anon read returning that data is correct behaviour.
  //   A human confirms whether the leaked record was meant to be private.
  //   AUTHZ_UNCERTAIN is the flag-for-review bucket for every ambiguous case the spec
  //   enumerates (signed / capability-URL routing, un-refreshable per-request nonce, a
  //   CSRF refresh that could explain the 200, infra 403/429 vs authz 403). Its score
  //   sits below every auto-assert signal so a co-firing real signal always wins
  //   selection, and it never auto-generates a test.
  CROSS_ACCOUNT_LEAK: { score: 1.0, severity: 'critical', tier: 'flag-for-review' },
  AUTHZ_UNCERTAIN: { score: 0.5, severity: 'low', tier: 'flag-for-review' },

  // Passive one-shot security checks (DECISION_LOG 018). All flag-for-review:
  // a missing header / weak cookie flag / error body pattern is a deployment gap,
  // not an unambiguous application crash, so they must not share the auto-assert tier.
  MISSING_SECURITY_HEADERS: { score: 0.3, severity: 'low',    tier: 'flag-for-review' },
  INSECURE_COOKIES:         { score: 0.4, severity: 'low',    tier: 'flag-for-review' },
  INFO_DISCLOSURE:          { score: 0.7, severity: 'medium', tier: 'flag-for-review' },
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
