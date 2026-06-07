// Stage 7 — pure aggregation over harvested findings + manifest rows.
// Kept side-effect-free so it's unit-testable; the CLI does the file IO.

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0, unknown: 0 };

// findings: [{slug, url, platform, severity, signal, surpriseScore, folder}]
// manifestRows: Map<slug,row> (last-wins) — used for run-status counts.
export function summarize(findings, manifestRows = new Map()) {
  const bySeverity = {};
  const bySignal = {};
  const byPlatform = {};
  const targetsWithFindings = new Set();

  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;

    const sig = (bySignal[f.signal] ??= { findings: 0, targets: new Set() });
    sig.findings += 1;
    sig.targets.add(f.slug);

    const plat = f.platform ?? 'unknown';
    byPlatform[plat] = (byPlatform[plat] ?? 0) + 1;

    targetsWithFindings.add(f.slug);
  }

  // Collapse the Set into a count for a serializable summary.
  const bySignalOut = {};
  for (const [sig, v] of Object.entries(bySignal)) {
    bySignalOut[sig] = { findings: v.findings, distinctTargets: v.targets.size };
  }

  const statusCounts = {};
  for (const row of manifestRows.values()) {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
  }

  // Disclosure queue: critical + high, ordered by severity then signal.
  const disclosure = findings
    .filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK.high)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  return {
    totals: {
      findings: findings.length,
      targetsWithFindings: targetsWithFindings.size,
      manifestTargets: manifestRows.size,
    },
    statusCounts,
    bySeverity,
    bySignal: bySignalOut,
    byPlatform,
    disclosure,
  };
}

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

export function renderReport(summary, { generatedAt = '' } = {}) {
  const s = summary;
  const sevRows = Object.entries(s.bySeverity)
    .sort((a, b) => (SEVERITY_RANK[b[0]] ?? 0) - (SEVERITY_RANK[a[0]] ?? 0))
    .map(([sev, n]) => [sev, n]);
  const sigRows = Object.entries(s.bySignal)
    .sort((a, b) => b[1].findings - a[1].findings)
    .map(([sig, v]) => [sig, v.findings, v.distinctTargets]);
  const platRows = Object.entries(s.byPlatform).map(([p, n]) => [p, n]);
  const statusRows = Object.entries(s.statusCounts).map(([st, n]) => [st, n]);

  const out = [];
  out.push('# Mass-test report', '');
  if (generatedAt) out.push(`Generated: ${generatedAt}`, '');

  out.push('## Run summary', '');
  out.push(`- Targets in manifest: **${s.totals.manifestTargets}**`);
  out.push(`- Targets with ≥1 finding: **${s.totals.targetsWithFindings}**`);
  out.push(`- Total findings: **${s.totals.findings}**`, '');
  if (statusRows.length) out.push(table(['status', 'count'], statusRows), '');

  out.push('## Findings by severity', '');
  out.push(sevRows.length ? table(['severity', 'count'], sevRows) : '_none_', '');

  out.push('## Findings by signal', '');
  out.push(sigRows.length ? table(['signal', 'findings', 'distinct targets'], sigRows) : '_none_', '');

  out.push('## Findings by platform', '');
  out.push(platRows.length ? table(['platform', 'count'], platRows) : '_none_', '');

  out.push('## Disclosure queue (critical + high)', '');
  if (s.disclosure.length) {
    for (const f of s.disclosure) {
      out.push(`- **[${f.severity}]** ${f.signal} — ${f.url}`);
      out.push(`  - evidence: \`${f.folder}\``);
    }
  } else {
    out.push('_no critical/high findings_');
  }
  out.push('');

  return out.join('\n');
}
