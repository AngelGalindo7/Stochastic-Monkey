import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config/loader.js';
import { validate } from '../../src/config/schema.js';

const SAMPLE = `
target:
  url: https://example.com
  allowedDomains: [example.com]
  blockedSelectors: []
run:
  seed: 1
  maxSteps: 10
actions:
  weights: { CLICK: 0.5, INPUT: 0.5 }
mcts:
  ucbC: 1.4
observability:
  otel:
    enabled: true
    path: BUG/\${RUN_ID}/trace.jsonl
`;

function tmpYaml(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmcfg-'));
  const p = path.join(dir, 'cfg.yaml');
  fs.writeFileSync(p, contents);
  return p;
}

describe('config.loader', () => {
  it('loads a valid config', () => {
    const p = tmpYaml(SAMPLE);
    const cfg = loadConfig({ configPath: p });
    expect(cfg.target.url).toBe('https://example.com');
    expect(cfg.run.seed).toBe(1);
  });

  it('substitutes ${RUN_ID}', () => {
    const p = tmpYaml(SAMPLE);
    const cfg = loadConfig({ configPath: p, runId: 'abc12345' });
    expect(cfg.observability.otel.path).toBe('BUG/abc12345/trace.jsonl');
  });

  it('throws on missing required field', () => {
    const broken = SAMPLE.replace(/url: https:\/\/example.com/, '');
    const p = tmpYaml(broken);
    expect(() => loadConfig({ configPath: p })).toThrow(/url/);
  });

  it('applies env overrides', () => {
    const p = tmpYaml(SAMPLE);
    const cfg = loadConfig({
      configPath: p,
      env: { HEURISTIC_SEED: '999', HEURISTIC_MAX_STEPS: '5' },
    });
    expect(cfg.run.seed).toBe(999);
    expect(cfg.run.maxSteps).toBe(5);
  });
});

describe('config.loader auth.cookies', () => {
  const withCookies = (cookieBlock) => `
target:
  url: https://example.com
  allowedDomains: [example.com]
  blockedSelectors: []
run:
  seed: 1
  maxSteps: 5
actions:
  weights: { CLICK: 1 }
mcts:
  ucbC: 1.4
${cookieBlock}
`;

  it('accepts a valid cookies array', () => {
    const yml = withCookies(`auth:
  cookies:
    - { name: session, value: abc, domain: example.com }
`);
    const p = tmpYaml(yml);
    const cfg = loadConfig({ configPath: p });
    expect(cfg.auth.cookies).toHaveLength(1);
    expect(cfg.auth.cookies[0].name).toBe('session');
  });

  it('rejects cookie missing domain or url', () => {
    const yml = withCookies(`auth:
  cookies:
    - { name: session, value: abc }
`);
    const p = tmpYaml(yml);
    expect(() => loadConfig({ configPath: p })).toThrow(/domain.*url/);
  });

  it('rejects cookies that is not an array', () => {
    const yml = withCookies(`auth:
  cookies: "not an array"
`);
    const p = tmpYaml(yml);
    expect(() => loadConfig({ configPath: p })).toThrow(/auth\.cookies must be an array/);
  });

  it('omitted auth block is fine', () => {
    const p = tmpYaml(SAMPLE);
    const cfg = loadConfig({ configPath: p });
    expect(cfg.auth).toBeUndefined();
  });
});

describe('config.schema.validate', () => {
  it('rejects non-http URLs', () => {
    expect(() =>
      validate({
        target: { url: 'ftp://x', allowedDomains: ['x'] },
        run: { seed: 1, maxSteps: 1 },
        actions: { weights: { CLICK: 1 } },
        mcts: { ucbC: 1 },
      }),
    ).toThrow(/http/);
  });

  it('rejects empty allowedDomains', () => {
    expect(() =>
      validate({
        target: { url: 'http://x', allowedDomains: [] },
        run: { seed: 1, maxSteps: 1 },
        actions: { weights: { CLICK: 1 } },
        mcts: { ucbC: 1 },
      }),
    ).toThrow(/allowedDomains/);
  });

  it('rejects zero-sum weights', () => {
    expect(() =>
      validate({
        target: { url: 'http://x', allowedDomains: ['x'] },
        run: { seed: 1, maxSteps: 1 },
        actions: { weights: { CLICK: 0, INPUT: 0 } },
        mcts: { ucbC: 1 },
      }),
    ).toThrow(/weights/);
  });

  it('rejects unknown observability.otel.exporter', () => {
    expect(() =>
      validate({
        target: { url: 'http://x', allowedDomains: ['x'] },
        run: { seed: 1, maxSteps: 1 },
        actions: { weights: { CLICK: 1 } },
        mcts: { ucbC: 1 },
        observability: { otel: { exporter: 'filee' } },
      }),
    ).toThrow(/exporter/);
  });

  it('accepts each valid observability.otel.exporter value', () => {
    for (const exporter of ['file', 'otlp', 'both']) {
      expect(() =>
        validate({
          target: { url: 'http://x', allowedDomains: ['x'] },
          run: { seed: 1, maxSteps: 1 },
          actions: { weights: { CLICK: 1 } },
          mcts: { ucbC: 1 },
          observability: { otel: { exporter } },
        }),
      ).not.toThrow();
    }
  });
});
