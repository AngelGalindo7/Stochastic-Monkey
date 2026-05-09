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

export function buildSurprisePrompt({ prediction, observed, hardSignals }) {
  return [
    'You are a QA evaluator. A prediction was made about a UI action. The',
    'action ran. Score how surprising the actual result was on a 0..1 scale.',
    '0 = exactly matched prediction. 1 = totally diverged or broke.',
    'Reply with JSON: {"score": <number>, "reason": "<one short sentence>"}',
    '',
    `Prediction: ${prediction}`,
    '',
    'Observed (pruned tree, truncated):',
    JSON.stringify(observed).slice(0, 4000),
    '',
    `Page-level signals fired: ${JSON.stringify(hardSignals)}`,
    '',
    'JSON:',
  ].join('\n');
}
