import { listInteractiveNodes } from '../perception/a11yTree.js';

const ACTION_FOR_ROLE = {
  button: 'CLICK',
  link: 'CLICK',
  menuitem: 'CLICK',
  tab: 'CLICK',
  option: 'CLICK',
  checkbox: 'CLICK',
  radio: 'CLICK',
  switch: 'CLICK',
  textbox: 'INPUT',
  searchbox: 'INPUT',
  combobox: 'INPUT',
};

export function isBlocked(node, blockedSelectors = []) {
  const name = (node.name || '').toLowerCase();
  for (const sel of blockedSelectors) {
    const lc = sel.toLowerCase();
    if (lc.includes('logout') && name.includes('logout')) return true;
    if (lc.includes('delete') && (name.includes('delete') || name.includes('remove'))) return true;
    if (lc.includes('destructive') && node.destructive) return true;
  }
  return false;
}

export function candidateActions(a11yTree, { weights, blockedSelectors }) {
  const interactive = listInteractiveNodes(a11yTree);
  const out = [];
  for (const node of interactive) {
    if (isBlocked(node, blockedSelectors)) continue;
    const type = ACTION_FOR_ROLE[node.role];
    if (!type) continue;
    const prior = weights[type] ?? 0;
    if (prior <= 0) continue;
    out.push({ type, target: node, prior });
  }
  if (out.length === 0 && (weights.NAVIGATION ?? 0) > 0) {
    out.push({ type: 'NAVIGATION', target: null, prior: weights.NAVIGATION });
  }
  if ((weights.SCROLL ?? 0) > 0) {
    out.push({ type: 'SCROLL', target: null, prior: weights.SCROLL });
  }
  for (const t of ['BACK', 'FORWARD', 'REFRESH']) {
    if ((weights[t] ?? 0) > 0) {
      out.push({ type: t, target: null, prior: weights[t] });
    }
  }
  return out;
}

export function ucbScore({ visits, totalReward, parentVisits, prior, c }) {
  if (visits === 0) return Infinity;
  const exploit = totalReward / visits;
  const explore = c * Math.sqrt(Math.log(parentVisits || 1) / visits);
  return exploit + prior * explore;
}

export function selectChild(node, c) {
  let best = null;
  let bestScore = -Infinity;
  for (const child of node.children) {
    const score = ucbScore({
      visits: child.visits,
      totalReward: child.totalReward,
      parentVisits: node.visits,
      prior: child.action.prior,
      c,
    });
    if (score > bestScore) {
      bestScore = score;
      best = child;
    }
  }
  return { child: best, score: bestScore };
}

export function sampleByPrior(actions, rng) {
  const total = actions.reduce((sum, a) => sum + a.prior, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const a of actions) {
    r -= a.prior;
    if (r <= 0) return a;
  }
  return actions[actions.length - 1];
}
