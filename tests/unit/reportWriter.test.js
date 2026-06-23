import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildReportFolderName,
  renderStepLines,
  renderEvidenceBlock,
  reproSectionLines,
  renderRepro,
  writeReport,
} from '../../src/triage/reportWriter.js';

// ---------------------------------------------------------------------------
// buildReportFolderName
// ---------------------------------------------------------------------------

describe('buildReportFolderName', () => {
  it('sanitises colons in the ISO timestamp', () => {
    const name = buildReportFolderName({ ts: '2026-06-01T12:34:56.000Z', seed: 1, severity: 'high', root: 'BUG' });
    expect(name).not.toMatch(/:/);
    expect(name).toMatch(/2026-06-01T12-34-56Z/);
  });

  it('strips the milliseconds suffix', () => {
    const name = buildReportFolderName({ ts: '2026-06-01T12:34:56.789Z', seed: 1, severity: 'high', root: 'BUG' });
    expect(name).not.toMatch(/\.789/);
    expect(name).toMatch(/2026-06-01T12-34-56Z/);
  });

  it('produces the expected folder pattern', () => {
    const name = buildReportFolderName({ ts: '2026-06-01T00:00:00.000Z', seed: 42, severity: 'medium', root: 'FLAGGED' });
    expect(name).toMatch(/FLAGGED[\\/]2026-06-01T00-00-00Z__seed42__medium/);
  });

  it('uses path.join so it is platform-safe', () => {
    const name = buildReportFolderName({ ts: '2026-06-01T00:00:00.000Z', seed: 1, severity: 'low', root: 'BUG' });
    expect(path.isAbsolute(name)).toBe(false);
    expect(name.startsWith('BUG')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderStepLines
// ---------------------------------------------------------------------------

describe('renderStepLines', () => {
  it('returns an empty string for an empty breadcrumb array', () => {
    expect(renderStepLines([])).toBe('');
  });

  it('filters out non-action/navigate breadcrumbs', () => {
    const crumbs = [
      { type: 'signal', summary: 'HTTP_500' },
      { type: 'action', summary: 'CLICK on Submit' },
    ];
    const result = renderStepLines(crumbs);
    expect(result).not.toMatch(/HTTP_500/);
    expect(result).toMatch(/CLICK on Submit/);
  });

  it('numbers steps starting from 1', () => {
    const crumbs = [
      { type: 'navigate', summary: 'goto https://example.com' },
      { type: 'action', summary: 'CLICK on Login' },
    ];
    expect(renderStepLines(crumbs)).toBe('1. goto https://example.com\n2. CLICK on Login');
  });

  it('handles a single breadcrumb', () => {
    expect(renderStepLines([{ type: 'action', summary: 'CLICK on Btn' }])).toBe('1. CLICK on Btn');
  });
});

// ---------------------------------------------------------------------------
// renderEvidenceBlock
// ---------------------------------------------------------------------------

describe('renderEvidenceBlock', () => {
  it('returns empty string when evidence array is empty', () => {
    expect(renderEvidenceBlock([])).toBe('');
  });

  it('returns empty string when called with no argument', () => {
    expect(renderEvidenceBlock()).toBe('');
  });

  it('includes the evidence section header', () => {
    const block = renderEvidenceBlock([{ signal: 'HTTP_500', detail: '500 from /api' }]);
    expect(block).toMatch(/## Evidence/);
  });

  it('renders each signal and detail as a bullet', () => {
    const block = renderEvidenceBlock([
      { signal: 'HTTP_500', detail: 'POST /api returned 500' },
      { signal: 'PAGEERROR', detail: 'TypeError in app.js' },
    ]);
    expect(block).toMatch(/\*\*HTTP_500\*\*/);
    expect(block).toMatch(/POST \/api returned 500/);
    expect(block).toMatch(/\*\*PAGEERROR\*\*/);
    expect(block).toMatch(/TypeError in app\.js/);
  });
});

// ---------------------------------------------------------------------------
// reproSectionLines
// ---------------------------------------------------------------------------

describe('reproSectionLines', () => {
  it('returns an array with the ## How to reproduce header', () => {
    const lines = reproSectionLines('BUG/folder/run');
    expect(lines).toContain('## How to reproduce');
  });

  it('includes the node command with forward slashes', () => {
    const lines = reproSectionLines('BUG\\folder\\run');
    const command = lines.find((l) => l.startsWith('node '));
    expect(command).toBeDefined();
    expect(command).not.toMatch(/\\/);
  });

  it('references breadcrumbs.jsonl and trace.jsonl', () => {
    const joined = reproSectionLines('BUG/folder/run').join('\n');
    expect(joined).toMatch(/breadcrumbs\.jsonl/);
    expect(joined).toMatch(/trace\.jsonl/);
  });
});

// ---------------------------------------------------------------------------
// renderRepro
// ---------------------------------------------------------------------------

describe('renderRepro', () => {
  it('embeds the seed, pageUrl, and configPath', () => {
    const repro = renderRepro({ seed: 7, pageUrl: 'https://example.com', configPath: 'config.yaml' });
    expect(repro).toMatch(/HEURISTIC_SEED.*7/);
    expect(repro).toMatch(/https:\/\/example\.com/);
    expect(repro).toMatch(/config\.yaml/);
  });

  it('produces a valid-looking ESM script (import keyword present)', () => {
    const repro = renderRepro({ seed: 1, pageUrl: 'https://example.com', configPath: 'config.yaml' });
    expect(repro).toMatch(/^\/\/ Auto-generated/);
    expect(repro).toMatch(/import/);
    expect(repro).toMatch(/spawnSync/);
  });
});

// ---------------------------------------------------------------------------
// writeReport — end-to-end artifact creation
// ---------------------------------------------------------------------------

describe('writeReport', () => {
  it('creates the report folder and all required artifacts', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
    const { folder } = await writeReport({
      rootDir,
      root: 'BUG',
      seed: 3,
      severity: 'high',
      pageUrl: 'https://example.com',
      breadcrumbs: [
        { type: 'navigate', summary: 'goto example.com' },
        { type: 'action', summary: 'CLICK on Submit' },
      ],
      markdownFile: 'bug.md',
      renderMarkdown: (folderRel) => `# Bug\nFolder: ${folderRel}`,
      severityPayload: { signal: 'PAGEERROR', severity: 'high' },
    });

    expect(fs.existsSync(folder)).toBe(true);
    expect(fs.existsSync(path.join(folder, 'breadcrumbs.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'repro.js'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'severity.json'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'bug.md'))).toBe(true);
  });

  it('writes screenshot.png only when screenshotBuffer is provided', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
    const { folder: folderWith } = await writeReport({
      rootDir,
      root: 'BUG',
      seed: 1,
      severity: 'low',
      pageUrl: 'https://example.com',
      breadcrumbs: [],
      screenshotBuffer: Buffer.from('png'),
      markdownFile: 'bug.md',
      renderMarkdown: () => '# Bug',
      severityPayload: {},
    });
    expect(fs.existsSync(path.join(folderWith, 'screenshot.png'))).toBe(true);

    const { folder: folderWithout } = await writeReport({
      rootDir,
      root: 'BUG',
      seed: 2,
      severity: 'low',
      pageUrl: 'https://example.com',
      breadcrumbs: [],
      markdownFile: 'bug.md',
      renderMarkdown: () => '# Bug',
      severityPayload: {},
    });
    expect(fs.existsSync(path.join(folderWithout, 'screenshot.png'))).toBe(false);
  });

  it('writes dom.html only when domHtml is non-empty', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
    const { folder } = await writeReport({
      rootDir,
      root: 'BUG',
      seed: 5,
      severity: 'medium',
      pageUrl: 'https://example.com',
      breadcrumbs: [],
      domHtml: '<html><body></body></html>',
      markdownFile: 'bug.md',
      renderMarkdown: () => '# Bug',
      severityPayload: {},
    });
    expect(fs.existsSync(path.join(folder, 'dom.html'))).toBe(true);
  });

  it('breadcrumbs.jsonl contains one JSON line per breadcrumb', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
    const crumbs = [
      { type: 'navigate', summary: 'goto example.com' },
      { type: 'action', summary: 'CLICK on Buy' },
    ];
    const { folder } = await writeReport({
      rootDir,
      root: 'BUG',
      seed: 9,
      severity: 'high',
      pageUrl: 'https://example.com',
      breadcrumbs: crumbs,
      markdownFile: 'bug.md',
      renderMarkdown: () => '# Bug',
      severityPayload: {},
    });
    const lines = fs.readFileSync(path.join(folder, 'breadcrumbs.jsonl'), 'utf8').split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe('navigate');
    expect(JSON.parse(lines[1]).type).toBe('action');
  });

  it('returns { folder, folderRel } with folderRel rooted at the root arg', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
    const { folderRel } = await writeReport({
      rootDir,
      root: 'BUG',
      seed: 1,
      severity: 'low',
      pageUrl: 'https://example.com',
      breadcrumbs: [],
      markdownFile: 'bug.md',
      renderMarkdown: () => '# Bug',
      severityPayload: {},
    });
    expect(folderRel.startsWith('BUG')).toBe(true);
  });

  it('copies trace.jsonl when tracePath points to an existing file', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
    const traceFile = path.join(rootDir, 'run.trace.jsonl');
    fs.writeFileSync(traceFile, '{"event":"start"}\n{"event":"end"}\n');
    const { folder } = await writeReport({
      rootDir,
      root: 'BUG',
      seed: 2,
      severity: 'high',
      pageUrl: 'https://example.com',
      breadcrumbs: [],
      markdownFile: 'bug.md',
      renderMarkdown: () => '# Bug',
      severityPayload: {},
      tracePath: 'run.trace.jsonl',
    });
    const dest = path.join(folder, 'trace.jsonl');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toContain('"event":"start"');
  });

  it('skips trace.jsonl when tracePath points to a non-existent file', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
    const { folder } = await writeReport({
      rootDir,
      root: 'BUG',
      seed: 3,
      severity: 'high',
      pageUrl: 'https://example.com',
      breadcrumbs: [],
      markdownFile: 'bug.md',
      renderMarkdown: () => '# Bug',
      severityPayload: {},
      tracePath: 'does-not-exist.jsonl',
    });
    expect(fs.existsSync(path.join(folder, 'trace.jsonl'))).toBe(false);
  });
});
