import { runClick } from './click.js';
import { runInput } from './input.js';
import { runNavigate } from './navigate.js';
import { runScroll } from './scroll.js';
import { runBack, runForward, runRefresh } from './history.js';

const HANDLERS = {
  CLICK: runClick,
  INPUT: runInput,
  NAVIGATION: runNavigate,
  SCROLL: runScroll,
  BACK: runBack,
  FORWARD: runForward,
  REFRESH: runRefresh,
};

export async function runMacro({ macro, page, config, rng, breadcrumbs }) {
  const stepResults = [];
  let success = true;
  for (const step of macro.steps) {
    const handler = HANDLERS[step.type];
    if (!handler) {
      stepResults.push({ type: step.type, success: false, error: 'unknown step type' });
      success = false;
      continue;
    }
    const target = step.target ? { role: step.targetRole ?? 'button', name: step.target } : null;
    const args = {
      page,
      target,
      dataPool: step.value ? [step.value] : config.actions.dataPool ?? [],
      rng,
      allowedDomains: config.target.allowedDomains,
      currentUrl: page.raw.url(),
    };
    const r = await handler(args);
    stepResults.push({ type: step.type, ...r });
    if (breadcrumbs) {
      breadcrumbs.record(
        'macro.step',
        `[${macro.name}] ${step.type}${step.target ? ` "${step.target}"` : ''} -> ${r.success ? 'ok' : 'fail'}`,
      );
    }
    if (!r.success && step.required !== false) {
      success = false;
      break;
    }
    if (step.delayMs) {
      await new Promise((res) => setTimeout(res, step.delayMs));
    }
  }
  return { success, stepResults };
}
