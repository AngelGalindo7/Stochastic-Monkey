const LAYOUT_ONLY_ROLES = new Set([
  'generic',
  'none',
  'presentation',
  'group',
  'paragraph',
  'text',
]);

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'tab',
  'option',
]);

export function pruneLayout(node) {
  if (!node) return null;
  const children = Array.isArray(node.children)
    ? node.children.map(pruneLayout).filter(Boolean)
    : [];

  const isInteractive = INTERACTIVE_ROLES.has(node.role);
  const isContainer =
    !LAYOUT_ONLY_ROLES.has(node.role) || (node.name && node.name.length > 0);

  if (!isInteractive && !isContainer && children.length === 0) {
    return null;
  }

  const out = { role: node.role };
  if (node.name) out.name = node.name;
  if (typeof node.value === 'string' && node.value.length) out.value = node.value;
  if (children.length) out.children = children;
  return out;
}

export function listInteractiveNodes(tree, acc = []) {
  if (!tree) return acc;
  if (INTERACTIVE_ROLES.has(tree.role)) acc.push(tree);
  if (Array.isArray(tree.children)) {
    for (const child of tree.children) listInteractiveNodes(child, acc);
  }
  return acc;
}

export async function snapshotPage(page) {
  const raw = await page.accessibility.snapshot({ interestingOnly: false });
  return pruneLayout(raw);
}
