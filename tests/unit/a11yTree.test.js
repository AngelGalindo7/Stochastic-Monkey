import { describe, it, expect } from 'vitest';
import { pruneLayout, listInteractiveNodes } from '../../src/perception/a11yTree.js';

describe('a11yTree.pruneLayout', () => {
  it('drops layout-only nodes with no children', () => {
    const tree = {
      role: 'main',
      children: [
        { role: 'generic', name: '', children: [] },
        { role: 'button', name: 'Click', children: [] },
      ],
    };
    const out = pruneLayout(tree);
    expect(out.children.length).toBe(1);
    expect(out.children[0].role).toBe('button');
  });

  it('preserves layout-only nodes that wrap interactive children', () => {
    const tree = {
      role: 'main',
      children: [
        {
          role: 'generic',
          name: '',
          children: [{ role: 'button', name: 'Inside', children: [] }],
        },
      ],
    };
    const out = pruneLayout(tree);
    expect(out.children[0].children[0].name).toBe('Inside');
  });

  it('returns JSON-serialisable output', () => {
    const tree = { role: 'main', children: [{ role: 'button', name: 'X', children: [] }] };
    const out = pruneLayout(tree);
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('returns null for null input', () => {
    expect(pruneLayout(null)).toBe(null);
  });
});

describe('a11yTree.listInteractiveNodes', () => {
  it('finds buttons, links, textboxes', () => {
    const tree = {
      role: 'main',
      children: [
        { role: 'button', name: 'A' },
        { role: 'link', name: 'B' },
        { role: 'textbox', name: 'C' },
        { role: 'paragraph', name: 'D' },
      ],
    };
    const nodes = listInteractiveNodes(tree);
    const names = nodes.map((n) => n.name);
    expect(names).toEqual(['A', 'B', 'C']);
  });
});
