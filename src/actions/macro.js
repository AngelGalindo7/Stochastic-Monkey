import { runClick } from './click.js';
import { runInput } from './input.js';
import { runNavigate } from './navigate.js';
import { runScroll } from './scroll.js';
import { runBack, runForward, runRefresh } from './history.js';
import { runUpload } from './upload.js';

const HANDLERS = {
  CLICK: runClick,
  INPUT: runInput,
  NAVIGATION: runNavigate,
  SCROLL: runScroll,
  BACK: runBack,
  FORWARD: runForward,
  REFRESH: runRefresh,
  UPLOAD: runUpload,
};

export async function runMacro({ macro, page, config, rng, breadcrumbs, projectRoot }) {
  const stepResults = [];
  let success = true;
  for (const step of macro.steps) {
    const handler = HANDLERS[step.type];
    if (!handler) {
      stepResults.push({ type: step.type, success: false, error: 'unknown step type' });
      success = false;
      continue;
    }
    const target = step.target
      ? step.type === 'UPLOAD'
        ? { selector: step.target }
        : { role: step.targetRole ?? 'button', name: step.target, selector: step.selector }
      : null;
    const args = {
      page,
      target,
      dataPool: step.value ? [step.value] : config.actions.dataPool ?? [],
      rng,
      allowedDomains: config.target.allowedDomains,
      currentUrl: page.raw.url(),
      filesPool: config.actions?.filesPool ?? [],
      projectRoot,
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
    // SPAs hydrate after domcontentloaded; wait for net-idle so the next step doesn't race the React mount.
    await page.raw.waitForNetworkIdle?.({ idleTime: 300, timeout: 2000 })?.catch(() => {});
    if (step.delayMs) {
      await new Promise((res) => setTimeout(res, step.delayMs));
    }
  }
  return { success, stepResults };
}
