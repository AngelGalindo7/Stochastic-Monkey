import fs from 'node:fs';
import path from 'node:path';

// Collect normalized findings from a target's BUG/ output dir.
//
// Each confirmed bug lands in <bugRoot>/<ts>__seed<n>__<severity>/ with a
// machine-readable severity.json ({severity, signal, surpriseScore}). We read
// those rather than parsing bug.md so results stay structured.
export function harvest({ bugRoot, slug = null, url = null, platform = null, disclosure_channel = 'none' }) {
  const findings = [];
  if (!fs.existsSync(bugRoot)) return findings;

  for (const entry of fs.readdirSync(bugRoot)) {
    // Bug folders are named "<ts>__seed<n>__<severity>"; run-id folders (which
    // only hold trace/breadcrumb/steps) are not — skip those.
    if (!entry.includes('__seed')) continue;
    const folder = path.join(bugRoot, entry);
    const sevPath = path.join(folder, 'severity.json');
    if (!fs.existsSync(sevPath)) continue;
    try {
      const sev = JSON.parse(fs.readFileSync(sevPath, 'utf8'));
      findings.push({
        slug,
        url,
        platform,
        disclosure_channel,
        severity: sev.severity ?? 'unknown',
        signal: sev.signal ?? 'unknown',
        surpriseScore: sev.surpriseScore ?? null,
        folder,
      });
    } catch {
      /* malformed severity.json — skip */
    }
  }
  return findings;
}
