import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clusterId } from '../../src/agent/stateAbstraction.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '..', 'fixtures', 'sample-a11y-tree.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

describe('stateAbstraction.clusterId', () => {
  it('returns a stable 12-char hex id', () => {
    const id = clusterId(fixture, 'medium');
    expect(id).toMatch(/^[a-f0-9]{12}$/);
  });

  it('different granularity may produce different ids', () => {
    const fine = clusterId(fixture, 'fine');
    const coarse = clusterId(fixture, 'coarse');
    expect(typeof fine).toBe('string');
    expect(typeof coarse).toBe('string');
  });

  it('two trees identical except for numeric IDs collide', () => {
    const a = JSON.parse(JSON.stringify(fixture));
    const b = JSON.parse(JSON.stringify(fixture));
    b.children[1].children[0].name = 'Order #11111';
    b.children[1].children[1].name = 'Order #22222';
    expect(clusterId(a, 'medium')).toBe(clusterId(b, 'medium'));
  });

  it('structurally different trees differ', () => {
    const a = JSON.parse(JSON.stringify(fixture));
    const b = JSON.parse(JSON.stringify(fixture));
    b.children[1].children[0].children = [{ role: 'button', name: 'Sell now' }];
    expect(clusterId(a, 'fine')).not.toBe(clusterId(b, 'fine'));
  });
});
