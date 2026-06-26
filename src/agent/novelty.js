import { flattenRoleNames } from './stateAbstraction.js';

// Roles that represent a distinct new surface rather than an in-place control
// change. Their appearance is scored as a "new screen" (0.8), not a "new
// widget" (0.5).
const SCREEN_ROLES = new Set(['dialog', 'alertdialog', 'menu', 'drawer', 'tabpanel']);

// Accessible names that mutate on every render but carry no structural signal.
// normalizeForHash() (applied during set construction) already collapses long
// digit runs and UUIDs; these patterns catch the rest — relative timestamps and
// opaque tokens (CSRF / nonce / session ids). A (role,name) pair whose name
// matches is ignored when deciding whether a genuinely new control appeared,
// so notification banners and "3 seconds ago" labels don't fire false novelty.
export const DEFAULT_LOW_SIGNAL = [
  /\b(\d+|N) (second|minute|hour|day|week|month|year)s? ago\b/i,
  /^[A-Za-z0-9_-]{24,}$/,
  /csrf|xsrf|nonce/i,
];

function nameOf(pair) {
  const idx = pair.indexOf('|');
  return idx === -1 ? '' : pair.slice(idx + 1);
}

function roleOf(pair) {
  const idx = pair.indexOf('|');
  return idx === -1 ? pair : pair.slice(0, idx);
}

function isLowSignalPair(pair, patterns) {
  const name = nameOf(pair);
  if (!name) return false;
  return patterns.some((re) => re.test(name));
}

function stripHash(url) {
  if (!url) return url;
  return url.split('#')[0];
}

// Deterministic per-step novelty in the same discrete buckets the old LLM
// rubric used. This is an EXPLORATION reward for MCTS only — it never declares a
// bug. Bug detection is owned entirely by hard signals (HTTP error codes,
// pageerror, etc.) in expectations.js.
export function scoreNovelty({
  prevA11y = null,
  currA11y = null,
  prevUrl = null,
  currUrl = null,
  currentStateId = null,
  recentStateIds = [],
  lowSignalExtra = [],
}) {
  // 0.0 — we have been in this state cluster before. Refresh/scroll/no-op loops.
  if (currentStateId && recentStateIds.includes(currentStateId)) {
    return { score: 0.0, reason: 'repeat state cluster' };
  }

  const patterns = lowSignalExtra.length ? [...DEFAULT_LOW_SIGNAL, ...lowSignalExtra] : DEFAULT_LOW_SIGNAL;
  const prevSet = flattenRoleNames(prevA11y);
  const currSet = flattenRoleNames(currA11y);
  const newPairs = [...currSet].filter((p) => !prevSet.has(p) && !isLowSignalPair(p, patterns));

  // 0.8 — distinct new screen: a modal/menu/drawer opened, or the route changed.
  const newScreen = newPairs.find((p) => SCREEN_ROLES.has(roleOf(p)));
  if (newScreen) return { score: 0.8, reason: `opened ${roleOf(newScreen)}` };
  if (currUrl && prevUrl && stripHash(currUrl) !== stripHash(prevUrl)) {
    return { score: 0.8, reason: 'route changed' };
  }

  // 0.5 — a new (role, name) control appeared on the same screen.
  if (newPairs.length) return { score: 0.5, reason: `new ${newPairs[0]}` };

  // 0.2 — controls unchanged, only low-signal text shifted within them.
  if (!setsEqual(prevSet, currSet)) return { score: 0.2, reason: 'text shifted' };

  // 0.0 — no visible change.
  return { score: 0.0, reason: 'no change' };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
