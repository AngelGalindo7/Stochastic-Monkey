import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import seedrandom from 'seedrandom';

import { loadConfig } from './config/loader.js';
import { createBrowser } from './browser/browserFactory.js';
import { snapshotPage, getFileInputs } from './perception/a11yTree.js';
import { pageEventsToHardSignals } from './perception/httpSignals.js';
import { clusterId } from './agent/stateAbstraction.js';
import { candidateActions, sampleByPrior } from './agent/policy.js';
import { MctsNode, descend, backprop } from './agent/mcts.js';
import { scoreState } from './agent/expectations.js';
import { checkDomFrozen, DOM_FROZEN_SETTLE_MS } from './agent/signals.js';
import { initTelemetry, shutdownTelemetry, getTracer } from './observability/otel.js';
import { Breadcrumbs } from './observability/breadcrumbs.js';
import { writeBugReport } from './triage/triage.js';
import { runClick } from './actions/click.js';
import { runInput } from './actions/input.js';
import { runNavigate } from './actions/navigate.js';
import { runScroll } from './actions/scroll.js';
import { runBack, runForward, runRefresh } from './actions/history.js';
import { runMacro } from './actions/macro.js';
import { runUpload } from './actions/upload.js';

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ''), '..');

function parseArgs(argv) {
  const out = { configPath: 'config.yaml' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) {
      out.configPath = argv[i + 1];
      i++;
    }
  }
  return out;
}

function makeRunId(seed) {
  const ts = new Date().toISOString().slice(0, 19);
  return crypto.createHash('sha1').update(`${seed}-${ts}`).digest('hex').slice(0, 8);
}

async function executeAction({ action, page, config, rng, breadcrumbs }) {
  const currentUrl = page.raw.url();
  switch (action.type) {
    case 'CLICK':
      return runClick({ page, target: action.target });
    case 'INPUT':
      return runInput({ page, target: action.target, dataPool: config.actions.dataPool ?? [], rng });
    case 'NAVIGATION':
      return runNavigate({ page, allowedDomains: config.target.allowedDomains, currentUrl });
    case 'SCROLL':
      return runScroll({ page, rng });
    case 'BACK':
      return runBack({ page });
    case 'FORWARD':
      return runForward({ page });
    case 'REFRESH':
      return runRefresh({ page });
    case 'MACRO':
      return runMacro({ macro: action.macro, page, config, rng, breadcrumbs, projectRoot: PROJECT_ROOT });
    case 'UPLOAD':
      return runUpload({
        page,
        target: action.target,
        filesPool: config.actions.filesPool ?? [],
        rng,
        projectRoot: PROJECT_ROOT,
      });
    default:
      return { success: false, error: `unknown action ${action.type}` };
  }
}

function pickMacro(macros, rng) {
  if (!macros || macros.length === 0) return null;
  const total = macros.reduce((s, m) => s + (m.weight ?? 1), 0);
  let r = rng() * total;
  for (const m of macros) {
    r -= m.weight ?? 1;
    if (r <= 0) return m;
  }
  return macros[macros.length - 1];
}

// Runs one crawl arm (authenticated or anon) to completion.
// Returns { firstBug, fatalError }. Closes breadcrumbs; caller closes browser.
async function runArm({ role, page, seed, config, rng, tracer, breadcrumbs, stepsDir, targetOrigin }) {
  const engine = config.browser?.engine ?? 'playwright';
  let firstBug = null;
  let fatalError = null;

  try {
    if (role !== 'anon') {
      // Cookie + localStorage seeding for authenticated roles only.
      const configCookies = config.auth?.cookies ?? [];
      const existingCookies = await page.raw.cookies(config.target.url);
      const existingNames = new Set(existingCookies.map((c) => c.name));
      const needsCookieSeed = configCookies.some((c) => !existingNames.has(c.name));

      if (configCookies.length && needsCookieSeed) {
        const loginCfg = config.auth?.login;
        if (loginCfg?.email) {
          // Credentials login: POST to the backend's login endpoint, parse the
          // Set-Cookie response, and fill the values into the cookie templates
          // declared above. Removes the manual refresh_token paste — the response
          // is already a fresh access/refresh pair, so pre-refresh is skipped.
          // See DECISION_LOG 010.
          const res = await fetch(loginCfg.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: loginCfg.email, password: loginCfg.password }),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            const hint = res.status === 429
              ? ' (rate limit: /users/login allows 5/min, 20/hour per IP)'
              : '';
            breadcrumbs.record('auth.error', `login ${res.status}: ${body.slice(0, 160)}`);
            console.error(
              `\n[auth] Login failed (${res.status})${hint}.\n` +
                `Check auth.login in config.yaml. Server said:\n  ${body.slice(0, 240)}\n`,
            );
            throw new Error('login failed; aborting before SPA boot');
          }
          const setCookies = res.headers.getSetCookie?.() ?? [];
          const rotated = {};
          for (const sc of setCookies) {
            const [pair] = sc.split(';');
            const eq = pair.indexOf('=');
            if (eq > 0) rotated[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
          }
          const seeded = configCookies
            .filter((c) => rotated[c.name] !== undefined)
            .map((c) => ({ ...c, value: rotated[c.name] }));
          if (!seeded.length) {
            throw new Error('login ok but no matching cookies in Set-Cookie response');
          }
          await page.raw.setCookie(...seeded);
          breadcrumbs.record('auth', `login ok; seeded ${seeded.length} cookie(s)`);
        } else {
          await page.raw.setCookie(...configCookies);
          breadcrumbs.record('auth', `injected ${configCookies.length} cookie(s)`);

          // Pre-refresh: when seeding from config, immediately rotate the tokens
          // via the backend's refresh endpoint BEFORE the SPA boots its own refresh.
          // Shrinks the race window between "you pasted the token" and "the SPA
          // burns it" — if the configured refresh token is already revoked, we fail
          // here with a clear error rather than a confusing /Login bounce later.
          if (config.auth?.refreshUrl) {
            const cookieHeader = configCookies.map((c) => `${c.name}=${c.value}`).join('; ');
            const res = await fetch(config.auth.refreshUrl, {
              method: 'POST',
              headers: { Cookie: cookieHeader },
            });
            if (!res.ok) {
              const body = await res.text().catch(() => '');
              breadcrumbs.record('auth.error', `pre-refresh ${res.status}: ${body.slice(0, 160)}`);
              console.error(
                `\n[auth] Pre-refresh failed (${res.status}). Your configured refresh_token is dead.\n` +
                  `Paste a fresh one into config.yaml and run again. Server said:\n  ${body.slice(0, 240)}\n`,
              );
              throw new Error('pre-refresh failed; aborting before SPA boot');
            }
            const setCookies = res.headers.getSetCookie?.() ?? [];
            const rotated = {};
            for (const sc of setCookies) {
              const [pair] = sc.split(';');
              const eq = pair.indexOf('=');
              if (eq > 0) rotated[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
            }
            const updated = configCookies
              .filter((c) => rotated[c.name] !== undefined)
              .map((c) => ({ ...c, value: rotated[c.name] }));
            if (updated.length) {
              await page.raw.setCookie(...updated);
              breadcrumbs.record('auth', `pre-refresh ok; rotated ${updated.length} cookie(s) in jar`);
            } else {
              breadcrumbs.record('auth', 'pre-refresh ok; no Set-Cookie in response');
            }
          }
        }
      } else if (configCookies.length) {
        breadcrumbs.record('auth', `reusing ${configCookies.length} persisted cookie(s)`);
      }
    }

    await page.raw.goto(config.target.url, {
      waitUntil: engine === 'playwright' ? 'networkidle' : 'networkidle2',
      timeout: 30000,
    });

    if (role !== 'anon') {
      const lsEntries = Object.entries(config.auth?.localStorage ?? {});
      if (lsEntries.length) {
        const presentKeys = await page.raw.evaluate(
          (keys) => keys.filter((k) => localStorage.getItem(k) !== null),
          lsEntries.map(([k]) => k),
        );
        if (presentKeys.length < lsEntries.length) {
          await page.raw.evaluate((entries) => {
            for (const [k, v] of entries) localStorage.setItem(k, v);
          }, lsEntries);
          await page.raw.goto(config.target.url, { waitUntil: engine === 'playwright' ? 'networkidle' : 'networkidle2', timeout: 30000 });
          breadcrumbs.record('auth', `seeded ${lsEntries.length} localStorage key(s); re-navigated`);
        } else {
          breadcrumbs.record('auth', `reusing ${lsEntries.length} persisted localStorage key(s)`);
        }
      }
    }

    await page.raw
      .waitForFunction(
        () => document.body && document.body.querySelectorAll('a, button, input, [role]').length > 0,
        { timeout: 10000 },
      )
      .catch(() => {});
    breadcrumbs.record('navigate', `goto ${config.target.url}`);

    const macroFireProb = config.macros?.fireProbability ?? 0;
    const macroList = config.macros?.list ?? [];
    const recentStateIds = [];
    const noveltyDenylist = (config.novelty?.nameDenylist ?? []).map((s) => new RegExp(s, 'i'));
    let prevA11y = null;
    let prevUrl = null;

    const root = new MctsNode({ stateId: 'ROOT' });

    for (let step = 0; step < config.run.maxSteps; step++) {
      const a11y = await snapshotPage(page.raw);
      const preActionUrl = page.raw.url();
      const fileInputs = await getFileInputs(page.raw);
      const stateId = clusterId(a11y, config.mcts.abstractionGranularity);
      recentStateIds.push(stateId);
      const cands = candidateActions(a11y, {
        weights: config.actions.weights,
        blockedSelectors: config.target.blockedSelectors,
        fileInputs,
      });
      if (cands.length === 0) {
        breadcrumbs.record('warn', 'no candidate actions; ending run');
        break;
      }

      let node = descend(root, config.mcts.ucbC);
      if (node.untriedActions.length === 0 && node.children.length === 0) {
        node.untriedActions = [...cands];
      }
      let action;
      const fireMacro = rng() < macroFireProb && macroList.length > 0;
      if (fireMacro) {
        const macro = pickMacro(macroList, rng);
        action = { type: 'MACRO', macro, prior: macro.weight ?? 1, target: null };
        node = node.addChild({ stateId, action });
      } else if (node.hasUntried()) {
        action = node.popUntried(rng);
        node = node.addChild({ stateId, action });
      } else {
        action = sampleByPrior(cands, rng) ?? cands[0];
        node = node.addChild({ stateId, action });
      }

      const desc = action.type === 'MACRO'
        ? `macro="${action.macro.name}"`
        : `${action.type} on "${action.target?.name ?? '-'}"`;
      breadcrumbs.record('action', `step=${step} ${desc}`);

      const beforeEvents = page.events.length;
      const beforeCaptures = page.captures?.length ?? 0;
      let result = { success: false };
      let surpriseResult = null;
      let hardEvidenceOuter = [];
      let observedForPrev = null;
      let observedUrlForPrev = null;

      await tracer.startActiveSpan(
        'mcts.expand',
        { attributes: { step, 'state.id': stateId, action: action.type, arm: role } },
        async (span) => {
          result = await executeAction({ action, page, config, rng, breadcrumbs });
          span.setAttribute('action.success', result.success);
          span.setAttribute('action.latency_ms', result.latencyMs ?? 0);
          await new Promise((r) => setTimeout(r, config.run.humanDelayMs ?? 0));

          const stepShot = await page.raw
            .screenshot({ fullPage: false, type: 'png' })
            .catch(() => null);
          if (stepShot) {
            fs.writeFileSync(path.join(stepsDir, `${step}.png`), stepShot);
          }

          const newEvents = page.events.slice(beforeEvents);
          // Skip DOM_FROZEN when the action triggered a navigation — an empty
          // body mid-transition is expected, not a blank-screen regression.
          const postActionUrl = page.raw.url();
          if (postActionUrl === preActionUrl && await checkDomFrozen(page, { settleMs: DOM_FROZEN_SETTLE_MS })) {
            newEvents.push({ type: 'DOM_FROZEN' });
          }
          const newCaptures = page.captures?.slice(beforeCaptures) ?? [];
          const observed = await snapshotPage(page.raw).catch(() => null);
          const observedUrl = page.raw.url();
          observedForPrev = observed;
          observedUrlForPrev = observedUrl;
          const observedStateId = observed
            ? clusterId(observed, config.mcts.abstractionGranularity)
            : null;
          const { signals: hardSignals, evidence: hardEvidence } =
            pageEventsToHardSignals(newEvents, targetOrigin);
          hardEvidenceOuter = hardEvidence;
          if (result.latencyMs > config.run.thresholdMs) hardSignals.push('PERF_BREACH');

          surpriseResult = scoreState({
            observed,
            prevA11y: prevA11y ?? a11y,
            currentUrl: observedUrl,
            prevUrl: prevUrl ?? preActionUrl,
            hardSignals,
            recentStateIds,
            currentStateId: observedStateId,
            lowSignalExtra: noveltyDenylist,
          });
          span.setAttribute('captures.count', newCaptures.length);
          span.setAttribute('novelty.score', surpriseResult.score);
          span.setAttribute('surprise.severity', surpriseResult.severity);
          span.setAttribute('surprise.is_bug', surpriseResult.isBug);
          if (surpriseResult.signalType) {
            span.setAttribute('surprise.signal', surpriseResult.signalType);
          }
          span.end();
        },
      );

      backprop(node, surpriseResult.score);
      prevA11y = observedForPrev ?? prevA11y;
      prevUrl = observedUrlForPrev ?? prevUrl;

      const currentUrl = page.raw.url();
      const isNoiseLocation = currentUrl === 'about:blank' || currentUrl === '';

      if (surpriseResult.isBug && !isNoiseLocation) {
        const screenshotBuffer = await page.raw
          .screenshot({ fullPage: true, type: 'png' })
          .catch(() => null);
        const domHtml = await page.raw.content().catch(() => '');
        firstBug = await writeBugReport({
          rootDir: PROJECT_ROOT,
          bugRoot: config.triage?.bugRoot ?? 'BUG',
          seed,
          severity: surpriseResult.severity,
          signal: surpriseResult.signalType ?? surpriseResult.reason ?? 'unknown_signal',
          pageUrl: currentUrl,
          breadcrumbs: breadcrumbs.all(),
          screenshotBuffer,
          domHtml,
          surpriseScore: surpriseResult.score,
          evidence: hardEvidenceOuter,
          tracePath: config.observability?.otel?.path,
          stepsDirRel: path.relative(PROJECT_ROOT, stepsDir),
          config,
        });
        breadcrumbs.record('bug.write', `wrote ${firstBug.folderRel}`);
        if (config.run.stopOnFirstBug) break;
      } else if (surpriseResult.isBug && isNoiseLocation) {
        breadcrumbs.record(
          'bug.skipped',
          `skipped: page is at "${currentUrl}" (back-from-fresh artifact, not a real bug)`,
        );
      }
    }
  } catch (err) {
    breadcrumbs.record('error', err.message, { stack: err.stack });
    const tookActions = breadcrumbs.all().some((b) => b.type === 'action');
    if (!firstBug && tookActions) {
      firstBug = await writeBugReport({
        rootDir: PROJECT_ROOT,
        bugRoot: config.triage?.bugRoot ?? 'BUG',
        seed,
        severity: 'high',
        signal: `agent_crash: ${err.message}`,
        pageUrl: page?.raw?.url?.() ?? config.target.url,
        breadcrumbs: breadcrumbs.all(),
        config,
      });
    } else if (!firstBug) {
      // No bug AND no action taken — the run aborted inside the harness itself
      // (perception/auth threw on step 0). That is a broken run, not a clean
      // "no bug found"; surface it rather than masking it as a success exit.
      fatalError = err;
    }
  } finally {
    breadcrumbs.record('run.end', firstBug ? `bug: ${firstBug.folderRel}` : 'no bug found');
    await breadcrumbs.close();
  }

  return { firstBug, fatalError };
}

async function main() {
  const args = parseArgs(process.argv);
  const seedSource = process.env.HEURISTIC_SEED ?? null;

  const preConfig = loadConfig({ configPath: args.configPath });
  const seed = seedSource !== null ? Number(seedSource) : preConfig.run.seed;
  const runId = makeRunId(seed);

  const config = loadConfig({ configPath: args.configPath, runId });

  const tracer = initTelemetry({ runId, seed, otelConfig: config.observability?.otel });

  let targetOrigin = '';
  try { targetOrigin = new URL(config.target.url).origin; } catch { /* invalid url */ }

  const persistSession = config.auth?.persistSession === true;
  const engine = config.browser?.engine ?? 'playwright';
  const browser = await createBrowser({
    engine,
    preferLightpanda: engine === 'puppeteer',
    headful: process.env.HEADFUL === 'true',
    userDataDir: persistSession ? path.resolve(PROJECT_ROOT, engine === 'playwright' ? '.playwright-data' : '.puppeteer-data') : undefined,
    storageState: config.browser?.storageState,
    roles: config.auth?.roles,
  });

  // Determine which roles to run. Defaults to ['user'] for backwards compat
  // when no roles are configured; expands to all declared roles otherwise.
  const declaredRoles = config.auth?.roles ? Object.keys(config.auth.roles) : ['user'];

  let combinedFirstBug = null;
  let combinedFatalError = null;

  try {
    for (const role of declaredRoles) {
      const page = await browser.newPage(role);
      const armSuffix = role === 'user' ? '' : `-${role}`;

      const bcBasePath = config.observability?.breadcrumbs?.path ?? `BUG/${runId}/breadcrumbs.jsonl`;
      const bcPath = bcBasePath.replace('.jsonl', `${armSuffix}.jsonl`);

      const breadcrumbs = new Breadcrumbs({
        filePath: bcPath,
        enabled: config.observability?.breadcrumbs?.enabled !== false,
      });

      const stepsDir = path.resolve(
        PROJECT_ROOT,
        config.triage?.bugRoot ?? 'BUG',
        runId,
        role === 'user' ? 'steps' : `steps-${role}`,
      );
      fs.mkdirSync(stepsDir, { recursive: true });

      // Each arm gets a fresh rng from the same seed for reproducible per-arm
      // action sequences; arms are independent crawls of the same target.
      const rng = seedrandom(String(seed));

      breadcrumbs.record('run.start', `run ${runId} arm=${role} seed=${seed} target=${config.target.url}`);
      console.log(`\n[run] arm=${role} seed=${seed}`);

      const { firstBug, fatalError } = await runArm({
        role,
        page,
        seed,
        config,
        rng,
        tracer,
        breadcrumbs,
        stepsDir,
        targetOrigin,
      });

      if (firstBug && !combinedFirstBug) combinedFirstBug = firstBug;
      if (fatalError && !combinedFatalError) combinedFatalError = fatalError;
    }
  } finally {
    await browser.close().catch(() => {});
    await shutdownTelemetry();
  }

  if (combinedFirstBug) {
    console.log(`\nBUG: ${combinedFirstBug.folderRel}`);
    process.exitCode = 0;
  } else if (combinedFatalError) {
    console.error(`\n[fatal] run ${runId} aborted before the first action: ${combinedFatalError.message}`);
    if (combinedFatalError.stack) console.error(combinedFatalError.stack);
    process.exitCode = 1;
  } else {
    console.log(`\nrun ${runId} completed without surfacing a bug.`);
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
