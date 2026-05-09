import { describe, it, expect } from 'vitest';
import {
  highestSeverity,
  severityFromEvents,
  severityFromScore,
  SIGNAL_SEVERITY,
} from '../../src/triage/severity.js';

describe('severity.highestSeverity', () => {
  it('picks critical over high', () => {
    expect(highestSeverity(['PAGEERROR', 'HTTP_5XX'])).toBe('critical');
  });
  it('picks high over medium', () => {
    expect(highestSeverity(['HTTP_4XX', 'PAGEERROR'])).toBe('high');
  });
  it('returns low for unknown signals', () => {
    expect(highestSeverity(['UNKNOWN'])).toBe('low');
  });
});

describe('severity.severityFromEvents', () => {
  it('reads event types', () => {
    const events = [{ type: 'HTTP_5XX' }, { type: 'CONSOLE_ERROR' }];
    expect(severityFromEvents(events)).toBe('critical');
  });
});

describe('severity.severityFromScore', () => {
  it('maps score buckets', () => {
    expect(severityFromScore(0.99)).toBe('critical');
    expect(severityFromScore(0.9)).toBe('high');
    expect(severityFromScore(0.7)).toBe('medium');
    expect(severityFromScore(0.1)).toBe('low');
  });
});

describe('severity.SIGNAL_SEVERITY', () => {
  it('covers every signal mcts/agent emits', () => {
    const required = [
      'PAGEERROR',
      'HTTP_5XX',
      'HTTP_4XX',
      'ASSET_4XX',
      'REQUEST_FAILED',
      'CONSOLE_ERROR',
      'PERF_BREACH',
      'DOM_FROZEN',
    ];
    for (const sig of required) {
      expect(SIGNAL_SEVERITY[sig]).toBeDefined();
    }
  });
});
