export function buildPredictPrompt({ a11yTree, action, recentActions = [] }) {
  const historyBlock = recentActions.length
    ? [
        'Recent actions taken on this site (oldest first):',
        ...recentActions.map((a, i) => `  ${i + 1}. ${a}`),
        '',
      ].join('\n')
    : '';
  return [
    'You are a QA assistant. Given the accessibility tree of a web page and a',
    'proposed user action, predict in ONE short sentence what should happen.',
    'Focus on observable outcomes (page change, dialog, form submission, error).',
    'Do NOT speculate beyond what the tree implies.',
    '',
    historyBlock,
    'Accessibility tree (pruned, layout removed):',
    JSON.stringify(a11yTree).slice(0, 6000),
    '',
    `Proposed action: ${action.type} on { role: "${action.target?.role ?? 'unknown'}", name: "${action.target?.name ?? ''}" }`,
    '',
    'Prediction (one sentence):',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildSurprisePrompt({
  prediction,
  observed,
  hardSignals = [],
  recentActions = [],
  recentStateIds = new Set(),
  currentStateId = null,
}) {
  const observedJson = JSON.stringify(observed).slice(0, 4000);
  const recentList = recentActions.length
    ? recentActions.map((a, i) => `- ${i + 1}. ${a}`).join('\n')
    : '- (none)';
  const recentIdsView = recentStateIds.size
    ? JSON.stringify([...recentStateIds].slice(-8))
    : '[]';
  const repeated = Boolean(currentStateId) && recentStateIds.has(currentStateId);

  return [
    '# QA Surprise Evaluator',
    '',
    'You score how surprising a UI action result is. Pick exactly one bucket from the rubric below. Do not blend, average, or interpolate.',
    '',
    '## SCORE RUBRIC — pick exactly one of {0.0, 0.2, 0.5, 0.8, 1.0}',
    '',
    '| Score | Use when |',
    '|---|---|',
    '| 0.0 | Observed state matches (or is a near-duplicate of) a recent state, OR there is no visible change beyond text/timestamps. Refresh / scroll / no-op loops are ALWAYS 0.0. |',
    '| 0.2 | Predicted change happened but with no novelty: same interactive roles, same URL fragment, only inner text shifted within the same widgets. |',
    '| 0.5 | New widgets appeared or disappeared — a role/name not present in any recent state. Same screen, different controls. |',
    '| 0.8 | Distinct new screen reached: URL/route changed, a dialog/modal/drawer opened, or a new section is now interactive. |',
    '| 1.0 | Page broke, threw, froze, or rendered an unexpected error visible from the tree alone (hard signals are scored separately by the harness). |',
    '',
    '## ANTI-LOOP RULES (strict — violating them is a wrong answer)',
    '',
    '1. **Repetition is never surprising.** If the current state cluster id appears in the recent state ids list, you MUST return 0.0.',
    '2. **No hedging.** The only legal scores are 0.0, 0.2, 0.5, 0.8, 1.0. Never invent intermediate values to feel "safe".',
    '3. **Novelty must be evidenced.** Any score ≥ 0.5 must name, in `reason`, the specific role / accessible name / URL fragment that was not present in recent states.',
    '4. **Ignore prediction quality.** A vague or stub prediction (e.g. "the page will change") cannot justify surprise. Only the observed tree counts.',
    '5. **Same-cluster refreshes score 0.0**, even if numeric counters, timestamps, or analytics pixels changed.',
    '',
    '## INPUTS',
    '',
    `Prediction: ${prediction}`,
    '',
    'Recent actions (oldest → newest):',
    recentList,
    '',
    `Recent state cluster ids (most recent last): ${recentIdsView}`,
    `Current state cluster id: ${currentStateId ?? 'unknown'}`,
    `Repeated state detected by harness: ${repeated ? 'YES — score MUST be 0.0' : 'no'}`,
    `Page-level hard signals fired: ${JSON.stringify(hardSignals)}`,
    '',
    'Observed accessibility tree (pruned, truncated to 4000 chars):',
    observedJson,
    '',
    '## OUTPUT',
    '',
    'Reply with JSON on a single line, no markdown fence, no surrounding prose. Schema:',
    '{"score": <0.0|0.2|0.5|0.8|1.0>, "reason": "<≤ 14 words; name the new element or write \\"repeat\\">"}',
    '',
    'JSON:',
  ].join('\n');
}
