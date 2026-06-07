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
  if (page._isLightpanda) {
    return snapshotLightpanda(page.cdp);
  }
  const raw = await page.accessibility.snapshot({ interestingOnly: false });
  return pruneLayout(raw);
}

export async function getFileInputs(page) {
  if (page._isLightpanda) return [];
  try {
    return await page.evaluate(() => {
      const out = [];
      const inputs = document.querySelectorAll('input[type="file"]');
      inputs.forEach((el, idx) => {
        let selector;
        if (el.id) selector = `#${CSS.escape(el.id)}`;
        else if (el.getAttribute('data-testid')) selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
        else if (el.name) selector = `input[type="file"][name="${CSS.escape(el.name)}"]`;
        else selector = `input[type="file"]:nth-of-type(${idx + 1})`;
        out.push({
          selector,
          accept: el.accept || '',
          multiple: !!el.multiple,
        });
      });
      return out;
    });
  } catch {
    return [];
  }
}

async function snapshotLightpanda(cdp) {
  const { tree } = await cdp.send('LP.getSemanticTree');
  return pruneSemanticTree(tree);
}

function pruneSemanticTree(node) {
  if (!node) return null;
  const children = Array.isArray(node.children)
    ? node.children.map(pruneSemanticTree).filter(Boolean)
    : [];

  const role = node.role ?? 'generic';
  const name = node.name ?? '';
  const isInteractive = INTERACTIVE_ROLES.has(role);
  const isContainer = !LAYOUT_ONLY_ROLES.has(role) || name.length > 0;

  if (!isInteractive && !isContainer && children.length === 0) return null;

  const out = { role };
  if (name) out.name = name;
  if (typeof node.value === 'string' && node.value.length) out.value = node.value;
  if (children.length) out.children = children;
  return out;
}

// Enumerate file inputs so the UPLOAD action can target them. Runs in-page via
// evaluate(), which is identical on Puppeteer and Playwright, so it is
// engine-agnostic. Lightpanda has no upload surface — return empty.
export async function getFileInputs(page) {
  if (page._isLightpanda) return [];
  try {
    return await page.evaluate(() => {
      const out = [];
      const inputs = document.querySelectorAll('input[type="file"]');
      inputs.forEach((el, idx) => {
        let selector;
        if (el.id) selector = `#${CSS.escape(el.id)}`;
        else if (el.getAttribute('data-testid'))
          selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
        else if (el.name)
          selector = `input[type="file"][name="${CSS.escape(el.name)}"]`;
        else selector = `input[type="file"]:nth-of-type(${idx + 1})`;
        out.push({ selector, accept: el.accept || '', multiple: !!el.multiple });
      });
      return out;
    });
  } catch {
    return [];
  }
}
