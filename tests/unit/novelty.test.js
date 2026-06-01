import { describe, it, expect } from 'vitest';
import { scoreNovelty } from '../../src/agent/novelty.js';

const tree = (children = []) => ({ role: 'main', children });

describe('novelty.scoreNovelty — discrete buckets', () => {
  it('0.0 when the current state cluster was seen recently', () => {
    const out = scoreNovelty({
      currentStateId: 'abc123',
      recentStateIds: ['xxx', 'abc123'],
      prevA11y: tree(),
      currA11y: tree([{ role: 'button', name: 'New' }]),
    });
    expect(out.score).toBe(0.0);
    expect(out.reason).toMatch(/repeat/);
  });

  it('0.8 when the route changes', () => {
    const out = scoreNovelty({
      prevUrl: 'http://app/list',
      currUrl: 'http://app/detail',
      prevA11y: tree(),
      currA11y: tree(),
    });
    expect(out.score).toBe(0.8);
  });

  it('0.8 when a dialog opens', () => {
    const out = scoreNovelty({
      prevA11y: tree([{ role: 'button', name: 'Delete' }]),
      currA11y: tree([{ role: 'button', name: 'Delete' }, { role: 'dialog', name: 'Confirm' }]),
    });
    expect(out.score).toBe(0.8);
    expect(out.reason).toMatch(/dialog/);
  });

  it('0.5 when a new control appears on the same screen', () => {
    const out = scoreNovelty({
      prevA11y: tree([{ role: 'button', name: 'A' }]),
      currA11y: tree([{ role: 'button', name: 'A' }, { role: 'link', name: 'Details' }]),
    });
    expect(out.score).toBe(0.5);
  });

  it('0.0 when nothing visibly changed', () => {
    const same = tree([{ role: 'button', name: 'A' }]);
    const out = scoreNovelty({ prevA11y: same, currA11y: tree([{ role: 'button', name: 'A' }]) });
    expect(out.score).toBe(0.0);
  });
});

describe('novelty — low-signal name suppression', () => {
  it('does not treat a changed numeric/timestamp label as a new control', () => {
    const out = scoreNovelty({
      prevA11y: tree([{ role: 'text', name: 'Updated 3 seconds ago' }]),
      currA11y: tree([{ role: 'text', name: 'Updated 47 seconds ago' }]),
    });
    // normalizeForHash collapses the digits; "N seconds ago" is denylisted.
    expect(out.score).toBeLessThan(0.5);
  });

  it('suppresses a fresh CSRF token from firing novelty', () => {
    const out = scoreNovelty({
      prevA11y: tree([{ role: 'textbox', name: 'csrf' }]),
      currA11y: tree([
        { role: 'textbox', name: 'csrf' },
        { role: 'textbox', name: 'a9f8c7b6d5e4f3a2b1c0d9e8f7a6b5c4' },
      ]),
    });
    expect(out.score).toBeLessThan(0.5);
  });

  it('honors caller-supplied extra denylist patterns', () => {
    const args = {
      prevA11y: tree([{ role: 'status', name: 'idle' }]),
      currA11y: tree([{ role: 'status', name: 'idle' }, { role: 'status', name: '5 unread' }]),
    };
    expect(scoreNovelty(args).score).toBe(0.5);
    expect(scoreNovelty({ ...args, lowSignalExtra: [/unread/i] }).score).toBeLessThan(0.5);
  });
});
