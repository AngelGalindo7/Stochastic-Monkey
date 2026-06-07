import { describe, it, expect, vi } from 'vitest';
import { pruneLayout, listInteractiveNodes, getFileInputs } from '../../src/perception/a11yTree.js';

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

  it('finds interactive nodes nested two levels deep', () => {
    const tree = {
      role: 'main',
      children: [
        {
          role: 'group',
          children: [
            { role: 'generic', children: [{ role: 'button', name: 'Deep' }] },
          ],
        },
      ],
    };
    const nodes = listInteractiveNodes(tree);
    expect(nodes.map((n) => n.name)).toContain('Deep');
  });
});

// Regression: getFileInputs was dropped during a11y rewrite and had to be
// restored. This test guards the export so the omission is caught at test time
// rather than at runtime when index.js fails to load.
describe('a11yTree.getFileInputs', () => {
  function fakePage(els) {
    return { raw: { $$eval: vi.fn(async (_sel, fn) => fn(els)) } };
  }

  it('returns descriptors for named file inputs', async () => {
    const page = fakePage([{ name: 'avatar', id: '', accept: 'image/*' }]);
    const inputs = await getFileInputs(page);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].name).toBe('avatar');
    expect(inputs[0].accept).toBe('image/*');
    expect(inputs[0].selector).toContain('avatar');
  });

  it('falls back to id selector when name is absent', async () => {
    const page = fakePage([{ name: '', id: 'doc-upload', accept: '.pdf' }]);
    const inputs = await getFileInputs(page);
    expect(inputs[0].name).toBe('doc-upload');
    expect(inputs[0].selector).toMatch(/^#/);
  });

  it('uses accept=* when attribute is empty', async () => {
    const page = fakePage([{ name: 'f', id: '', accept: '' }]);
    const inputs = await getFileInputs(page);
    expect(inputs[0].accept).toBe('*');
  });

  it('returns empty array when no file inputs exist', async () => {
    const page = fakePage([]);
    const inputs = await getFileInputs(page);
    expect(inputs).toEqual([]);
  });

  it('queries input[type="file"] selector', async () => {
    const page = fakePage([]);
    await getFileInputs(page);
    expect(page.raw.$$eval).toHaveBeenCalledWith('input[type="file"]', expect.any(Function));
  });

  it('uses nth-of-type selector and exposes index when name and id are absent', async () => {
    const page = fakePage([
      { name: '', id: '', accept: '' },
      { name: '', id: '', accept: 'image/*' },
    ]);
    const inputs = await getFileInputs(page);
    expect(inputs[0].index).toBe(0);
    expect(inputs[0].selector).toMatch(/nth-of-type\(1\)/);
    expect(inputs[1].index).toBe(1);
    expect(inputs[1].selector).toMatch(/nth-of-type\(2\)/);
  });
});
