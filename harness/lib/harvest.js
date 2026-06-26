import fs from 'node:fs';
import path from 'node:path';

// Collect normalized findings from a target's BUG/ and FLAGGED/ output dirs.
//
// BUG severity.json:     { severity, signal, surpriseScore }
// FLAGGED severity.json: { tier, confidence, signal, severity, score, reason }
// Both shapes are normalised into the same finding record.
export function harvest({ bugRoot, flaggedRoot = null, slug = null, url = null, platform = null, disclosure_channel = 'none' }) {
  const findings = [];

  for (const [root, tier] of [[bugRoot, 'bug'], [flaggedRoot, 'flag-for-review']]) {
    if (!root || !fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      // Report folders are named "<ts>__seed<n>__<severity>"; run-id folders
      // (trace/breadcrumb/steps only) are not — skip those.
      if (!entry.includes('__seed')) continue;
      const folder = path.join(root, entry);
      const sevPath = path.join(folder, 'severity.json');
      if (!fs.existsSync(sevPath)) continue;
      try {
        const sev = JSON.parse(fs.readFileSync(sevPath, 'utf8'));
        findings.push({
          slug,
          url,
          platform,
          disclosure_channel,
          tier,
          severity: sev.severity ?? 'unknown',
          signal: sev.signal ?? 'unknown',
          surpriseScore: sev.surpriseScore ?? sev.score ?? null,
          reason: sev.reason ?? null,
          folder,
        });
      } catch {
        /* malformed severity.json — skip */
      }
    }
  }
  return findings;
}
