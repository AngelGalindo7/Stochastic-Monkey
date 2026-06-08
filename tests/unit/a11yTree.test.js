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
// Implementation uses page.evaluate() (engine-agnostic) and returns
// { selector, accept, multiple } descriptors built inside the browser context.
describe('a11yTree.getFileInputs', () => {
  function fakePage(result = []) {
    return { evaluate: vi.fn().mockResolvedValue(result) };
  }

  it('returns descriptors from the page evaluate call', async () => {
    const expected = [{ selector: 'input[type="file"][name="avatar"]', accept: 'image/*', multiple: false }];
    const page = fakePage(expected);
    const inputs = await getFileInputs(page);
    expect(inputs).toEqual(expected);
  });

  it('returns empty array when no file inputs exist', async () => {
    const page = fakePage([]);
    const inputs = await getFileInputs(page);
    expect(inputs).toEqual([]);
  });

  it('delegates to page.evaluate (engine-agnostic, not $$eval)', async () => {
    const page = fakePage([]);
    await getFileInputs(page);
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function));
  });

  it('returns empty array for Lightpanda pages without calling evaluate', async () => {
    const page = { _isLightpanda: true, evaluate: vi.fn() };
    const inputs = await getFileInputs(page);
    expect(inputs).toEqual([]);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('returns empty array and swallows errors (detached frame guard)', async () => {
    const page = { evaluate: vi.fn().mockRejectedValue(new Error('Frame was detached')) };
    const inputs = await getFileInputs(page);
    expect(inputs).toEqual([]);
  });

  it('passes through selector with nth-of-type for anonymous inputs', async () => {
    const result = [
      { selector: 'input[type="file"]:nth-of-type(1)', accept: '', multiple: false },
      { selector: 'input[type="file"]:nth-of-type(2)', accept: 'image/*', multiple: true },
    ];
    const page = fakePage(result);
    const inputs = await getFileInputs(page);
    expect(inputs[0].selector).toMatch(/nth-of-type\(1\)/);
    expect(inputs[1].selector).toMatch(/nth-of-type\(2\)/);
    expect(inputs[1].multiple).toBe(true);
  });
});
