import crypto from 'node:crypto';

export function normalizeForHash(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(normalizeForHash);

  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'bounds' || k === 'nodeId' || k === 'backendDOMNodeId') continue;
    if (k === 'name' && typeof v === 'string') {
      out[k] = v
        .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, 'UUID')
        .replace(/\b\d{2,}\b/g, 'N')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      out[k] = normalizeForHash(v);
    }
  }
  if (Array.isArray(out.children)) {
    out.children = [...out.children].sort((a, b) => {
      const ar = (a.role || '') + (a.name || '');
      const br = (b.role || '') + (b.name || '');
      return ar.localeCompare(br);
    });
  }
  return out;
}

export function hashSubtree(node) {
  const normalized = normalizeForHash(node);
  return crypto
    .createHash('md5')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 12);
}
