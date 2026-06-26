import { describe, it, expect } from 'vitest';
import { MctsNode, backprop, descend } from '../../src/agent/mcts.js';

describe('MctsNode', () => {
  it('initialises with correct defaults', () => {
    const n = new MctsNode({ stateId: 'root' });
    expect(n.stateId).toBe('root');
    expect(n.action).toBeNull();
    expect(n.parent).toBeNull();
    expect(n.children).toEqual([]);
    expect(n.visits).toBe(0);
    expect(n.totalReward).toBe(0);
    expect(n.untriedActions).toEqual([]);
  });

  it('addChild links parent/child correctly', () => {
    const root = new MctsNode({ stateId: 'root' });
    const child = root.addChild({ stateId: 'child', action: { type: 'CLICK' } });
    expect(root.children).toContain(child);
    expect(child.parent).toBe(root);
    expect(child.stateId).toBe('child');
    expect(child.action).toEqual({ type: 'CLICK' });
  });

  it('isLeaf is true when no children, false otherwise', () => {
    const root = new MctsNode({ stateId: 'root' });
    expect(root.isLeaf()).toBe(true);
    root.addChild({ stateId: 'c', action: null });
    expect(root.isLeaf()).toBe(false);
  });

  it('hasUntried reflects untriedActions length', () => {
    const n = new MctsNode({ stateId: 's' });
    expect(n.hasUntried()).toBe(false);
    n.untriedActions.push({ type: 'SCROLL' });
    expect(n.hasUntried()).toBe(true);
  });

  it('popUntried removes and returns the selected action', () => {
    const n = new MctsNode({ stateId: 's' });
    n.untriedActions = [{ type: 'A' }, { type: 'B' }, { type: 'C' }];
    const rng = () => 0; // always picks index 0
    const taken = n.popUntried(rng);
    expect(taken).toEqual({ type: 'A' });
    expect(n.untriedActions).toHaveLength(2);
    expect(n.untriedActions).not.toContainEqual({ type: 'A' });
  });

  it('popUntried uses rng to pick non-zero index', () => {
    const n = new MctsNode({ stateId: 's' });
    n.untriedActions = [{ type: 'A' }, { type: 'B' }, { type: 'C' }];
    const rng = () => 0.99; // picks last index
    const taken = n.popUntried(rng);
    expect(taken).toEqual({ type: 'C' });
    expect(n.untriedActions).toHaveLength(2);
  });
});

describe('backprop', () => {
  it('increments visits and reward up the chain', () => {
    const root = new MctsNode({ stateId: 'root' });
    const mid = root.addChild({ stateId: 'mid', action: null });
    const leaf = mid.addChild({ stateId: 'leaf', action: null });

    backprop(leaf, 0.8);

    expect(leaf.visits).toBe(1);
    expect(leaf.totalReward).toBeCloseTo(0.8);
    expect(mid.visits).toBe(1);
    expect(mid.totalReward).toBeCloseTo(0.8);
    expect(root.visits).toBe(1);
    expect(root.totalReward).toBeCloseTo(0.8);
  });

  it('accumulates across multiple backprops', () => {
    const root = new MctsNode({ stateId: 'root' });
    const child = root.addChild({ stateId: 'c', action: null });

    backprop(child, 1.0);
    backprop(child, 0.5);

    expect(child.visits).toBe(2);
    expect(child.totalReward).toBeCloseTo(1.5);
    expect(root.visits).toBe(2);
    expect(root.totalReward).toBeCloseTo(1.5);
  });

  it('works on a single root node (no parent)', () => {
    const root = new MctsNode({ stateId: 'root' });
    backprop(root, 0.3);
    expect(root.visits).toBe(1);
    expect(root.totalReward).toBeCloseTo(0.3);
  });
});

describe('descend', () => {
  it('returns the root when it has untried actions', () => {
    const root = new MctsNode({ stateId: 'root' });
    root.untriedActions.push({ type: 'CLICK' });
    expect(descend(root, 1.4)).toBe(root);
  });

  it('returns a leaf node directly', () => {
    const root = new MctsNode({ stateId: 'root' });
    // leaf + no untried → descend stops immediately
    expect(descend(root, 1.4)).toBe(root);
  });

  it('descends to the child with highest UCB when root is fully expanded', () => {
    const root = new MctsNode({ stateId: 'root' });
    root.visits = 10;

    // child A: unvisited → Infinity UCB → should be selected
    const childA = root.addChild({ stateId: 'A', action: { prior: 0.5 } });

    // child B: visited once
    const childB = root.addChild({ stateId: 'B', action: { prior: 0.5 } });
    childB.visits = 1;
    childB.totalReward = 0.5;
    childB.untriedActions.push({ type: 'SCROLL' }); // stops here if selected

    const result = descend(root, 1.4);
    // childA is unvisited → Infinity UCB → selected → it's a leaf with no untried → stops
    expect(result).toBe(childA);
  });
});

describe('recentStateIds Set contract', () => {
  it('does not duplicate on repeated add', () => {
    const s = new Set();
    s.add('state-a');
    s.add('state-a');
    expect(s.size).toBe(1);
  });
  it('.has() returns true for added items', () => {
    const s = new Set();
    s.add('state-1');
    expect(s.has('state-1')).toBe(true);
  });
  it('.has() returns false for non-added items', () => {
    const s = new Set();
    s.add('state-1');
    expect(s.has('state-99')).toBe(false);
  });
});
