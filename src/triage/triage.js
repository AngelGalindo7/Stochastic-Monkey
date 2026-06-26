import {
  writeReport,
  buildReportFolderName,
  renderStepLines,
  renderEvidenceBlock,
  reproSectionLines,
} from './reportWriter.js';

export function buildBugFolderName({ ts, seed, severity, root = 'BUG' }) {
  return buildReportFolderName({ ts, seed, severity, root });
}

export function buildFlaggedFolderName({ ts, seed, severity, root = 'FLAGGED' }) {
  return buildReportFolderName({ ts, seed, severity, root });
}

export async function writeBugReport({
  rootDir,
  bugRoot = 'BUG',
  seed,
  severity,
  signal,
  pageUrl,
  breadcrumbs,
  screenshotBuffer = null,
  domHtml = '',
  surpriseScore = null,
  prediction = null,
  evidence = [],
  tracePath = null,
  stepsDirRel = null,
  config,
}) {
  return writeReport({
    rootDir,
    root: bugRoot,
    seed,
    severity,
    pageUrl,
    breadcrumbs,
    screenshotBuffer,
    domHtml,
    tracePath,
    markdownFile: 'bug.md',
    renderMarkdown: (folderRel) =>
      renderBugMd({
        pageUrl,
        severity,
        signal,
        seed,
        breadcrumbs,
        prediction,
        surpriseScore,
        folderRel,
        stepsDirRel,
        evidence,
      }),
    severityPayload: { severity, signal, surpriseScore },
  });
}

export async function writeFlaggedReport({
  rootDir,
  bugRoot = 'FLAGGED',
  seed,
  severity,
  signal,
  pageUrl,
  breadcrumbs,
  screenshotBuffer = null,
  domHtml = '',
  surpriseScore = null,
  prediction = null,
  evidence = [],
  tracePath = null,
  stepsDirRel = null,
  config,
  reason = '',
}) {
  return writeReport({
    rootDir,
    root: bugRoot,
    seed,
    severity,
    pageUrl,
    breadcrumbs,
    screenshotBuffer,
    domHtml,
    tracePath,
    markdownFile: 'flagged.md',
    renderMarkdown: (folderRel) =>
      renderFlaggedMd({
        pageUrl,
        severity,
        signal,
        seed,
        breadcrumbs,
        prediction,
        surpriseScore,
        folderRel,
        stepsDirRel,
        evidence,
        reason,
      }),
    severityPayload: {
      tier: 'flag-for-review',
      confidence: 'low',
      signal,
      severity,
      score: surpriseScore,
      reason,
    },
  });
}

function renderBugMd({
  pageUrl,
  severity,
  signal,
  seed,
  breadcrumbs,
  prediction,
  surpriseScore,
  folderRel,
  stepsDirRel,
  evidence = [],
}) {
  return [
    `# Bug Report — ${severity.toUpperCase()}`,
    '',
    `**URL:** ${pageUrl}`,
    `**Seed:** ${seed}`,
    `**Signal:** ${signal}`,
    surpriseScore !== null ? `**Surprise score:** ${surpriseScore.toFixed(2)}` : '',
    `**Folder:** ${folderRel}`,
    stepsDirRel ? `**Step screenshots:** ${stepsDirRel.replace(/\\/g, '/')}/` : '',
    '',
    renderEvidenceBlock(evidence),
    '## Steps the agent took before failure',
    '',
    renderStepLines(breadcrumbs) || '(no action breadcrumbs recorded)',
    '',
    prediction ? `## Predicted outcome\n\n> ${prediction}\n` : '',
    ...reproSectionLines(folderRel),
  ]
    .filter(Boolean)
    .join('\n');
}

function renderFlaggedMd({
  pageUrl,
  severity,
  signal,
  seed,
  breadcrumbs,
  prediction,
  surpriseScore,
  folderRel,
  stepsDirRel,
  evidence = [],
  reason = '',
}) {
  return [
    `# FLAGGED FOR REVIEW — ${signal}`,
    '',
    '**This is not a confirmed bug. The signal is ambiguous. Human review required.**',
    '',
    `**URL:** ${pageUrl}`,
    `**Seed:** ${seed}`,
    `**Signal:** ${signal}`,
    `**Severity:** ${severity}`,
    surpriseScore !== null ? `**Surprise score:** ${surpriseScore.toFixed(2)}` : '',
    `**Folder:** ${folderRel}`,
    stepsDirRel ? `**Step screenshots:** ${stepsDirRel.replace(/\\/g, '/')}/` : '',
    '',
    '## Why this is ambiguous',
    '',
    reason || '(no reason provided)',
    '',
    renderEvidenceBlock(evidence),
    '## Steps the agent took before flagging',
    '',
    renderStepLines(breadcrumbs) || '(no action breadcrumbs recorded)',
    '',
    prediction ? `## Predicted outcome\n\n> ${prediction}\n` : '',
    ...reproSectionLines(folderRel),
  ]
    .filter(Boolean)
    .join('\n');
}
