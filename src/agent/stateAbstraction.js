import { hashSubtree, normalizeForHash } from '../perception/domHash.js';

const GRANULARITY_DEPTH = {
  fine: 8,
  medium: 4,
  coarse: 2,
};

function truncateDepth(node, maxDepth) {
  if (!node || maxDepth <= 0) return null;
  const out = { role: node.role };
  if (node.name) out.name = node.name;
  if (Array.isArray(node.children)) {
    out.children = node.children
      .map((c) => truncateDepth(c, maxDepth - 1))
      .filter(Boolean);
  }
  return out;
}

export function clusterId(a11yTree, granularity = 'medium') {
  const depth = GRANULARITY_DEPTH[granularity] ?? GRANULARITY_DEPTH.medium;
  const truncated = truncateDepth(a11yTree, depth);
  return hashSubtree(truncated);
}

export { normalizeForHash };
