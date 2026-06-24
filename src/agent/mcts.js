/* Statistical-memo MCTS: this tree records which (state, action) pairs have been
   explored and their cumulative rewards, but does NOT re-navigate the browser to
   match the selected node before action execution. The tree bounds exploration via
   UCB1 scores but does not enforce state-graph consistency. Full re-navigation
   is deferred — it increases per-step cost 3-10x. See DECISION_LOG #021. */
import { selectChild } from './policy.js';

export class MctsNode {
  constructor({ stateId, action = null, parent = null }) {
    this.stateId = stateId;
    this.action = action;
    this.parent = parent;
    this.children = [];
    this.visits = 0;
    this.totalReward = 0;
    this.untriedActions = [];
  }

  addChild({ stateId, action }) {
    const child = new MctsNode({ stateId, action, parent: this });
    this.children.push(child);
    return child;
  }

  isLeaf() {
    return this.children.length === 0;
  }

  hasUntried() {
    return this.untriedActions.length > 0;
  }

  popUntried(rng) {
    const idx = Math.floor(rng() * this.untriedActions.length);
    const [taken] = this.untriedActions.splice(idx, 1);
    return taken;
  }
}

export function backprop(node, reward) {
  let cursor = node;
  while (cursor) {
    cursor.visits += 1;
    cursor.totalReward += reward;
    cursor = cursor.parent;
  }
}

export function descend(root, c) {
  let cursor = root;
  while (!cursor.isLeaf() && !cursor.hasUntried()) {
    const { child } = selectChild(cursor, c);
    if (!child) break;
    cursor = child;
  }
  return cursor;
}
