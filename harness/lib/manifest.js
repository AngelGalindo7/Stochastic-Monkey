import fs from 'node:fs';

// Append-only run manifest for resume/idempotency across a large batch.
//
// Each status change appends one JSON line keyed by slug. On load, the last row
// per slug wins — so an interrupted 5,600-target run can restart and skip
// anything already `done`. Append-only survives a crash mid-write better than
// rewriting the whole file.
//
// Row shape: { slug, url, status, runId?, findings?, exitCode?, reason?, ts }
//   status ∈ pending | running | done | failed | skipped

export function loadManifest(manifestPath) {
  const byslug = new Map();
  if (!fs.existsSync(manifestPath)) return byslug;
  const lines = fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.slug) byslug.set(row.slug, row); // last wins
    } catch {
      /* skip corrupt line */
    }
  }
  return byslug;
}

export function appendRow(manifestPath, row) {
  fs.appendFileSync(manifestPath, `${JSON.stringify(row)}\n`);
}

// A slug is "settled" (skip on resume) if it finished, timed out, or was
// deliberately skipped. Timeout counts as settled because the seed is fixed —
// a retry is deterministic and would just time out again. Only genuine
// `failed` (crash / non-zero exit) is eligible for retry.
export function isSettled(row) {
  return row && ['done', 'timeout', 'skipped'].includes(row.status);
}
