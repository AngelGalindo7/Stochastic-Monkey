import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSummaryReport } from '../../src/triage/summaryReport.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBug(overrides = {}) {
  return {
    signal: 'HTTP_500',
    severity: 'critical',
    pageUrl: 'https://example.com/api',
    folderRel: 'BUG/2026-06-01T00-00-00Z__seed1__critical',
    ...overrides,
  };
}

function run(extra = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
  return { rootDir, ...writeSummaryReport({
    rootDir,
    runId: 'abc12345',
    seed: 1,
    targetUrl: 'https://example.com',
    mode: 'authenticated',
    bugs: [],
    flagged: [],
    durationMs: 5000,
    ...extra,
  }) };
}

// ---------------------------------------------------------------------------
// File creation
// ---------------------------------------------------------------------------

describe('writeSummaryReport — file creation', () => {
  it('creates BUG/<runId>/summary/report.md', () => {
    const { rootDir } = run();
    expect(fs.existsSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'))).toBe(true);
  });

  it('creates BUG/<runId>/summary/report.json', () => {
    const { rootDir } = run();
    expect(fs.existsSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.json'))).toBe(true);
  });

  it('returns the relative path to report.md', () => {
    const rel = writeSummaryReport({
      rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-')),
      runId: 'abc12345',
      seed: 1,
      targetUrl: 'https://example.com',
      mode: 'anon',
      bugs: [],
      flagged: [],
      durationMs: 0,
    });
    expect(rel).toBe(path.join('BUG', 'abc12345', 'summary', 'report.md'));
  });
});

// ---------------------------------------------------------------------------
// Markdown content — header and metadata
// ---------------------------------------------------------------------------

describe('writeSummaryReport — markdown header', () => {
  it('includes the target URL', () => {
    const { rootDir } = run({ targetUrl: 'https://app.example.com' });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/https:\/\/app\.example\.com/);
  });

  it('includes the run ID and seed', () => {
    const { rootDir } = run();
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/abc12345/);
    expect(md).toMatch(/Seed.*1/);
  });

  it('includes the mode', () => {
    const { rootDir } = run({ mode: 'anon' });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/anon/);
  });
});

// ---------------------------------------------------------------------------
// Markdown content — findings count and tables
// ---------------------------------------------------------------------------

describe('writeSummaryReport — findings sections', () => {
  it('shows "No confirmed bugs found" when bugs is empty', () => {
    const { rootDir } = run();
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/No confirmed bugs found/);
  });

  it('shows "No flagged findings" when flagged is empty', () => {
    const { rootDir } = run();
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/No flagged findings/);
  });

  it('renders a bug table row with signal, severity, URL, and artifact path', () => {
    const { rootDir } = run({ bugs: [makeBug()] });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/HTTP_500/);
    expect(md).toMatch(/critical/);
    expect(md).toMatch(/example\.com\/api/);
    expect(md).toMatch(/BUG\/2026-06-01/);
  });

  it('renders a flagged table row', () => {
    const { rootDir } = run({ flagged: [makeBug({ signal: 'DOM_FROZEN', severity: 'medium' })] });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/DOM_FROZEN/);
  });

  it('includes the correct findings count in the heading', () => {
    const { rootDir } = run({ bugs: [makeBug(), makeBug({ signal: 'PAGEERROR' })], flagged: [makeBug({ signal: 'DOM_FROZEN' })] });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/2 bugs/);
    expect(md).toMatch(/1 flagged/);
  });

  it('uses singular "bug" when there is exactly one', () => {
    const { rootDir } = run({ bugs: [makeBug()] });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/1 bug[^s]/);
  });
});

// ---------------------------------------------------------------------------
// Markdown content — What to fix and duration
// ---------------------------------------------------------------------------

describe('writeSummaryReport — What to fix and duration', () => {
  it('includes the "What to fix" section when findings are present', () => {
    const { rootDir } = run({ bugs: [makeBug()] });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/## What to fix/);
    expect(md).toMatch(/HTTP_500/);
  });

  it('omits "What to fix" when there are no findings', () => {
    const { rootDir } = run();
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).not.toMatch(/## What to fix/);
  });

  it('uses a fallback advice line for an unknown signal', () => {
    const { rootDir } = run({ bugs: [makeBug({ signal: 'UNKNOWN_SIGNAL_XYZ' })] });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/Review occurrences of UNKNOWN_SIGNAL_XYZ/);
  });

  it('formats duration < 1000ms as ms', () => {
    const { rootDir } = run({ durationMs: 750 });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/750ms/);
  });

  it('formats duration >= 1000ms as seconds with one decimal', () => {
    const { rootDir } = run({ durationMs: 5000 });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/5\.0s/);
  });

  it('truncates a URL longer than 60 chars with ellipsis', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(50) + '/page';
    const { rootDir } = run({ bugs: [makeBug({ pageUrl: longUrl })] });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(/\.\.\./);
  });

  it('does not truncate a URL of exactly 60 chars', () => {
    const sixtyCharUrl = 'https://example.com/' + 'a'.repeat(40);
    expect(sixtyCharUrl.length).toBe(60);
    const { rootDir } = run({ bugs: [makeBug({ pageUrl: sixtyCharUrl })] });
    const md = fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.md'), 'utf8');
    expect(md).toMatch(sixtyCharUrl);
    expect(md).not.toMatch(/\.\.\./);
  });
});

// ---------------------------------------------------------------------------
// JSON artifact
// ---------------------------------------------------------------------------

describe('writeSummaryReport — JSON artifact', () => {
  it('report.json contains the same runId, seed, targetUrl, mode', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
    writeSummaryReport({
      rootDir,
      runId: 'def67890',
      seed: 99,
      targetUrl: 'https://staging.example.com',
      mode: 'anon',
      bugs: [],
      flagged: [],
      durationMs: 1234,
    });
    const json = JSON.parse(fs.readFileSync(path.join(rootDir, 'BUG', 'def67890', 'summary', 'report.json'), 'utf8'));
    expect(json.runId).toBe('def67890');
    expect(json.seed).toBe(99);
    expect(json.targetUrl).toBe('https://staging.example.com');
    expect(json.mode).toBe('anon');
    expect(json.durationMs).toBe(1234);
  });

  it('report.json bugs array length matches input', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
    writeSummaryReport({
      rootDir,
      runId: 'abc12345',
      seed: 1,
      targetUrl: 'https://example.com',
      mode: 'anon',
      bugs: [makeBug(), makeBug({ signal: 'PAGEERROR' })],
      flagged: [makeBug({ signal: 'DOM_FROZEN' })],
      durationMs: 0,
    });
    const json = JSON.parse(fs.readFileSync(path.join(rootDir, 'BUG', 'abc12345', 'summary', 'report.json'), 'utf8'));
    expect(json.bugs).toHaveLength(2);
    expect(json.flagged).toHaveLength(1);
  });
});
