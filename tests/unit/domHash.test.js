import { describe, it, expect } from 'vitest';
import { hashSubtree, normalizeForHash } from '../../src/perception/domHash.js';

describe('domHash', () => {
  it('produces identical hashes when only numeric IDs differ', () => {
    const a = { role: 'group', name: 'Order #4827', children: [{ role: 'button', name: 'Buy now' }] };
    const b = { role: 'group', name: 'Order #9123', children: [{ role: 'button', name: 'Buy now' }] };
    expect(hashSubtree(a)).toBe(hashSubtree(b));
  });

  it('produces identical hashes when child order differs', () => {
    const a = {
      role: 'list',
      children: [{ role: 'link', name: 'Home' }, { role: 'link', name: 'Cart' }],
    };
    const b = {
      role: 'list',
      children: [{ role: 'link', name: 'Cart' }, { role: 'link', name: 'Home' }],
    };
    expect(hashSubtree(a)).toBe(hashSubtree(b));
  });

  it('produces different hashes when structure differs', () => {
    const a = { role: 'button', name: 'Submit' };
    const b = { role: 'link', name: 'Submit' };
    expect(hashSubtree(a)).not.toBe(hashSubtree(b));
  });

  it('strips bounds / nodeId attributes', () => {
    const tree = { role: 'button', name: 'X', bounds: [1, 2, 3, 4], nodeId: 7 };
    const norm = normalizeForHash(tree);
    expect(norm.bounds).toBeUndefined();
    expect(norm.nodeId).toBeUndefined();
  });

  it('normalizes UUIDs in names', () => {
    const a = { role: 'group', name: 'Item 550e8400-e29b-41d4-a716-446655440000' };
    const b = { role: 'group', name: 'Item 7c9e6679-7425-40de-944b-e07fc1f90ae7' };
    expect(hashSubtree(a)).toBe(hashSubtree(b));
  });
});
