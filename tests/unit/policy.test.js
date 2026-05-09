import { describe, it, expect } from 'vitest';
import {
  candidateActions,
  ucbScore,
  selectChild,
  isBlocked,
  sampleByPrior,
} from '../../src/agent/policy.js';

const tree = {
  role: 'main',
  children: [
    { role: 'button', name: 'Buy' },
    { role: 'link', name: 'Logout' },
    { role: 'textbox', name: 'Search' },
    { role: 'button', name: 'Delete account' },
  ],
};

describe('policy.candidateActions', () => {
  const weights = { CLICK: 0.5, INPUT: 0.3, NAVIGATION: 0.1, SCROLL: 0.1 };

  it('drops blocked elements', () => {
    const acts = candidateActions(tree, {
      weights,
      blockedSelectors: ["a[href$='/logout']", "[data-destructive='true']"],
    });
    const names = acts.map((a) => a.target?.name).filter(Boolean);
    expect(names).not.toContain('Logout');
  });

  it('drops delete-style elements when blocker mentions delete', () => {
    const acts = candidateActions(tree, {
      weights,
      blockedSelectors: ['button[data-action="delete"]'],
    });
    const names = acts.map((a) => a.target?.name).filter(Boolean);
    expect(names).not.toContain('Delete account');
  });

  it('returns CLICK for buttons and INPUT for textboxes', () => {
    const acts = candidateActions(tree, { weights, blockedSelectors: [] });
    const click = acts.find((a) => a.target?.name === 'Buy');
    const input = acts.find((a) => a.target?.name === 'Search');
    expect(click.type).toBe('CLICK');
    expect(input.type).toBe('INPUT');
  });
});

describe('policy.candidateActions history actions', () => {
  it('emits BACK / FORWARD / REFRESH when weighted', () => {
    const weights = { CLICK: 0.4, BACK: 0.1, FORWARD: 0.05, REFRESH: 0.1 };
    const acts = candidateActions(tree, { weights, blockedSelectors: [] });
    const types = new Set(acts.map((a) => a.type));
    expect(types.has('BACK')).toBe(true);
    expect(types.has('FORWARD')).toBe(true);
    expect(types.has('REFRESH')).toBe(true);
  });

  it('omits history actions when weights are zero', () => {
    const weights = { CLICK: 0.5, BACK: 0, FORWARD: 0, REFRESH: 0 };
    const acts = candidateActions(tree, { weights, blockedSelectors: [] });
    const types = new Set(acts.map((a) => a.type));
    expect(types.has('BACK')).toBe(false);
    expect(types.has('FORWARD')).toBe(false);
    expect(types.has('REFRESH')).toBe(false);
  });
});

describe('policy.ucbScore', () => {
  it('returns Infinity for unvisited children', () => {
    expect(ucbScore({ visits: 0, totalReward: 0, parentVisits: 5, prior: 0.5, c: 1.4 })).toBe(Infinity);
  });

  it('higher value beats lower value with same visits', () => {
    const better = ucbScore({ visits: 4, totalReward: 3, parentVisits: 10, prior: 0.5, c: 1.4 });
    const worse = ucbScore({ visits: 4, totalReward: 1, parentVisits: 10, prior: 0.5, c: 1.4 });
    expect(better).toBeGreaterThan(worse);
  });
});

describe('policy.selectChild', () => {
  it('picks unvisited child first', () => {
    const node = {
      visits: 4,
      children: [
        { visits: 2, totalReward: 1, action: { prior: 0.5 } },
        { visits: 0, totalReward: 0, action: { prior: 0.1 } },
      ],
    };
    const { child } = selectChild(node, 1.4);
    expect(child).toBe(node.children[1]);
  });
});

describe('policy.isBlocked', () => {
  it('matches logout via name', () => {
    expect(isBlocked({ name: 'Logout' }, ["a[href$='/logout']"])).toBe(true);
  });
  it('does not match unrelated names', () => {
    expect(isBlocked({ name: 'Home' }, ["a[href$='/logout']"])).toBe(false);
  });
});

describe('policy.sampleByPrior', () => {
  it('respects weights when rng is deterministic', () => {
    const actions = [
      { type: 'A', prior: 0.9 },
      { type: 'B', prior: 0.1 },
    ];
    const counts = { A: 0, B: 0 };
    let seed = 0.001;
    for (let i = 0; i < 1000; i++) {
      const rng = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      const a = sampleByPrior(actions, rng);
      counts[a.type]++;
    }
    expect(counts.A).toBeGreaterThan(counts.B * 4);
  });
});
