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

const SEV_COLOR = {
  critical: '#ff4d4f',
  high: '#ff7a45',
  medium: '#ffc53d',
  low: '#73d13d',
  info: '#8c8c8c',
  unknown: '#8c8c8c',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function barRows(entries, color) {
  const max = Math.max(1, ...entries.map(([, n]) => (typeof n === 'object' ? n.findings : n)));
  return entries
    .map(([label, val]) => {
      const n = typeof val === 'object' ? val.findings : val;
      const extra = typeof val === 'object' ? ` <span class="muted">(${val.distinctTargets} targets)</span>` : '';
      const c = color === 'sev' ? SEV_COLOR[label] ?? '#8c8c8c' : '#4096ff';
      return `<div class="bar-row"><div class="bar-label">${esc(label)}${extra}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(n / max) * 100}%;background:${c}"></div></div>
        <div class="bar-num">${n}</div></div>`;
    })
    .join('\n');
}

// Self-contained HTML dashboard. `findings` may carry screenshotRel / folderRel
// (relative paths) added by the CLI so screenshots render and evidence links work
// when the file is opened from the run's output directory.
export function renderDashboardHtml(summary, findings = [], { generatedAt = '', title = 'Stochastic Monkey — Mass Test' } = {}) {
  const s = summary;
  const sevEntries = Object.entries(s.bySeverity).sort((a, b) => (SEVERITY_RANK[b[0]] ?? 0) - (SEVERITY_RANK[a[0]] ?? 0));
  const sigEntries = Object.entries(s.bySignal).sort((a, b) => b[1].findings - a[1].findings);
  const platEntries = Object.entries(s.byPlatform).sort((a, b) => b[1] - a[1]);
  const statusEntries = Object.entries(s.statusCounts);

  const critical = s.bySeverity.critical ?? 0;
  const high = s.bySeverity.high ?? 0;

  const rows = findings
    .slice()
    .sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0))
    .map((f) => {
      const sev = f.severity ?? 'unknown';
      const shot = f.screenshotRel
        ? `<a href="${esc(f.screenshotRel)}" target="_blank"><img loading="lazy" class="thumb" src="${esc(f.screenshotRel)}" alt="screenshot"></a>`
        : '<span class="muted">—</span>';
      const evidence = f.folderRel ? `<a href="${esc(f.folderRel)}" target="_blank">evidence</a>` : '';
      return `<tr data-sev="${esc(sev)}" data-platform="${esc(f.platform ?? 'unknown')}" data-signal="${esc(f.signal)}">
        <td><span class="badge" style="background:${SEV_COLOR[sev] ?? '#8c8c8c'}">${esc(sev)}</span></td>
        <td class="mono">${esc(f.signal)}</td>
        <td>${esc(f.platform ?? '')}</td>
        <td class="url"><a href="${esc(f.url)}" target="_blank">${esc(f.url)}</a></td>
        <td>${shot}</td>
        <td>${evidence}</td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  header{padding:24px 28px;border-bottom:1px solid #21262d}
  h1{margin:0 0 4px;font-size:20px}
  .muted{color:#8b949e}
  main{padding:24px 28px;max-width:1200px;margin:0 auto}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:28px}
  .card{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px}
  .card .n{font-size:28px;font-weight:700}
  .card .l{color:#8b949e;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .card.crit .n{color:${SEV_COLOR.critical}}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
  @media(max-width:800px){.grid{grid-template-columns:1fr}}
  .panel{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:18px}
  .panel h2{margin:0 0 14px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#8b949e}
  .bar-row{display:grid;grid-template-columns:160px 1fr 40px;align-items:center;gap:10px;margin:6px 0}
  .bar-label{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bar-track{background:#21262d;border-radius:5px;height:14px;overflow:hidden}
  .bar-fill{height:100%;border-radius:5px}
  .bar-num{text-align:right;font-variant-numeric:tabular-nums;color:#8b949e}
  .controls{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
  input,select{background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:7px;padding:7px 10px;font-size:13px}
  table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #21262d;border-radius:10px;overflow:hidden}
  th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #21262d;vertical-align:middle}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#8b949e;cursor:pointer;user-select:none}
  tr:last-child td{border-bottom:none}
  .badge{padding:2px 9px;border-radius:20px;font-size:12px;font-weight:600;color:#0d1117;text-transform:capitalize}
  .mono,.url a{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
  .url{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}
  .thumb{width:90px;height:54px;object-fit:cover;border-radius:5px;border:1px solid #30363d;display:block}
</style></head>
<body>
<header>
  <h1>🐒 ${esc(title)}</h1>
  <div class="muted">${generatedAt ? 'Generated ' + esc(generatedAt) + ' · ' : ''}passive read-only scan</div>
</header>
<main>
  <div class="cards">
    <div class="card"><div class="n">${s.totals.manifestTargets}</div><div class="l">Targets</div></div>
    <div class="card"><div class="n">${s.totals.targetsWithFindings}</div><div class="l">With findings</div></div>
    <div class="card"><div class="n">${s.totals.findings}</div><div class="l">Total findings</div></div>
    <div class="card crit"><div class="n">${critical}</div><div class="l">Critical</div></div>
    <div class="card"><div class="n">${high}</div><div class="l">High</div></div>
  </div>
  <div class="grid">
    <div class="panel"><h2>By severity</h2>${sevEntries.length ? barRows(sevEntries, 'sev') : '<span class="muted">none</span>'}</div>
    <div class="panel"><h2>By signal</h2>${sigEntries.length ? barRows(sigEntries) : '<span class="muted">none</span>'}</div>
    <div class="panel"><h2>By platform</h2>${platEntries.length ? barRows(platEntries) : '<span class="muted">none</span>'}</div>
    <div class="panel"><h2>Run status</h2>${statusEntries.length ? barRows(statusEntries) : '<span class="muted">none</span>'}</div>
  </div>
  <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#8b949e">Findings (${findings.length})</h2>
  <div class="controls">
    <input id="q" placeholder="filter url / signal / platform…" oninput="flt()">
    <select id="sev" onchange="flt()"><option value="">all severities</option>${sevEntries.map(([k]) => `<option>${esc(k)}</option>`).join('')}</select>
  </div>
  <table id="t"><thead><tr>
    <th onclick="srt(0)">Severity</th><th onclick="srt(1)">Signal</th><th onclick="srt(2)">Platform</th>
    <th onclick="srt(3)">URL</th><th>Shot</th><th>Evidence</th>
  </tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">no findings</td></tr>'}</tbody></table>
</main>
<script>
  const tb=document.querySelector('#t tbody');
  function flt(){const q=document.getElementById('q').value.toLowerCase();const sv=document.getElementById('sev').value;
    for(const r of tb.rows){const t=r.textContent.toLowerCase();const okq=!q||t.includes(q);const oks=!sv||r.dataset.sev===sv;
      r.style.display=okq&&oks?'':'none';}}
  let asc=[];function srt(c){asc[c]=!asc[c];const rows=[...tb.rows];
    rows.sort((a,b)=>{const x=a.cells[c].textContent.trim(),y=b.cells[c].textContent.trim();
      return (asc[c]?1:-1)*x.localeCompare(y,undefined,{numeric:true});});
    rows.forEach(r=>tb.appendChild(r));}
</script>
</body></html>`;
}
