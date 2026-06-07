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

// Flatten a tree into a Set of normalized "role|name" pairs. Names are run
// through normalizeForHash so digit runs and UUIDs collapse, making the set
// stable across cosmetic churn. Used by novelty.js to diff two states.
export function flattenRoleNames(tree) {
  const set = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.role) {
      const name = typeof node.name === 'string' ? normalizeForHash({ name: node.name }).name : '';
      set.add(`${node.role}|${name ?? ''}`);
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(tree);
  return set;
}

export { normalizeForHash };
