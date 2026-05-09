import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeBugReport, buildBugFolderName } from '../../src/triage/triage.js';

describe('triage.buildBugFolderName', () => {
  it('produces BUG/<safe-iso>__seedN__severity', () => {
    const name = buildBugFolderName({
      ts: '2026-05-06T12:34:56.123Z',
      seed: 42,
      severity: 'high',
    });
    expect(name).toMatch(/BUG[\\/]2026-05-06T12-34-56Z__seed42__high$/);
  });
});

describe('triage.writeBugReport', () => {
  it('writes all expected artifacts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hmtest-'));
    const result = await writeBugReport({
      rootDir: root,
      bugRoot: 'BUG',
      seed: 7,
      severity: 'medium',
      signal: 'ASSET_4XX',
      pageUrl: 'https://example.com',
      breadcrumbs: [
        { ts: 't1', type: 'navigate', summary: 'goto example.com' },
        { ts: 't2', type: 'action', summary: 'CLICK on Buy' },
      ],
      surpriseScore: 0.9,
      prediction: 'should load',
      config: {},
    });
    expect(fs.existsSync(result.folder)).toBe(true);
    expect(fs.existsSync(path.join(result.folder, 'breadcrumbs.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(result.folder, 'bug.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.folder, 'repro.js'))).toBe(true);
    expect(fs.existsSync(path.join(result.folder, 'severity.json'))).toBe(true);
    const bugMd = fs.readFileSync(path.join(result.folder, 'bug.md'), 'utf8');
    expect(bugMd).toMatch(/MEDIUM/);
    expect(bugMd).toMatch(/seed.*7/i);
    expect(bugMd).toMatch(/CLICK on Buy/);
  });
});
