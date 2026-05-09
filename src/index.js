import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import seedrandom from 'seedrandom';

import { loadConfig } from './config/loader.js';
import { createBrowser } from './browser/browserFactory.js';
import { snapshotPage } from './perception/a11yTree.js';
import { clusterId } from './agent/stateAbstraction.js';
import { candidateActions, sampleByPrior } from './agent/policy.js';
import { MctsNode, descend, backprop } from './agent/mcts.js';
import { predict, surprise } from './agent/expectations.js';
import { initTelemetry, shutdownTelemetry, getTracer } from './observability/otel.js';
import { Breadcrumbs } from './observability/breadcrumbs.js';
import { writeBugReport } from './triage/triage.js';
import { runClick } from './actions/click.js';
import { runInput } from './actions/input.js';
import { runNavigate } from './actions/navigate.js';
import { runScroll } from './actions/scroll.js';
import { runBack, runForward, runRefresh } from './actions/history.js';
import { runMacro } from './actions/macro.js';

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
      return runMacro({ macro: action.macro, page, config, rng, breadcrumbs });
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

const NOISE_PATTERNS = [
  /\/favicon\.ico$/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /doubleclick\.net/i,
  /facebook\.com\/tr/i,
];

function isNoiseUrl(url) {
  if (!url) return false;
  return NOISE_PATTERNS.some((re) => re.test(url));
}

function pageEventsToHardSignals(events) {
  const out = [];
  const evidence = [];
  for (const e of events) {
    if (e.type === 'PAGEERROR') {
      out.push('PAGEERROR');
      evidence.push({ signal: 'PAGEERROR', detail: e.message });
    } else if (e.type === 'HTTP_5XX') {
      out.push('HTTP_5XX');
      evidence.push({ signal: 'HTTP_5XX', detail: `${e.status} ${e.url}` });
    } else if ((e.type === 'HTTP_4XX' || e.type === 'REQUEST_FAILED') && !isNoiseUrl(e.url)) {
      out.push('ASSET_4XX');
      evidence.push({ signal: 'ASSET_4XX', detail: `${e.status ?? 'fail'} ${e.url}` });
    }
  }
  return { signals: out, evidence };
}

async function main() {
  const args = parseArgs(process.argv);
  const seedSource = process.env.HEURISTIC_SEED ?? null;

  const preConfig = loadConfig({ configPath: args.configPath });
  const seed = seedSource !== null ? Number(seedSource) : preConfig.run.seed;
  const runId = makeRunId(seed);

  const config = loadConfig({ configPath: args.configPath, runId });

  const tracer = initTelemetry({ runId, seed, otelConfig: config.observability?.otel });
  const breadcrumbs = new Breadcrumbs({
    filePath: config.observability?.breadcrumbs?.path,
    enabled: config.observability?.breadcrumbs?.enabled !== false,
  });

  breadcrumbs.record('run.start', `run ${runId} seed=${seed} target=${config.target.url}`);

  const rng = seedrandom(String(seed));
  const browser = await createBrowser({
    preferLightpanda: true,
    headful: process.env.HEADFUL === 'true',
  });
  const page = await browser.newPage();

  const root = new MctsNode({ stateId: 'ROOT' });
  let firstBug = null;

  const stepsDir = path.resolve(PROJECT_ROOT, config.triage?.bugRoot ?? 'BUG', runId, 'steps');
  fs.mkdirSync(stepsDir, { recursive: true });

  try {
    if (config.auth?.cookies?.length) {
      await page.raw.setCookie(...config.auth.cookies);
      breadcrumbs.record('auth', `injected ${config.auth.cookies.length} cookie(s)`);
    }

    await page.raw.goto(config.target.url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    breadcrumbs.record('navigate', `goto ${config.target.url}`);

    const macroFireProb = config.macros?.fireProbability ?? 0;
    const macroList = config.macros?.list ?? [];

    for (let step = 0; step < config.run.maxSteps; step++) {
      const a11y = await snapshotPage(page.raw);
      const stateId = clusterId(a11y, config.mcts.abstractionGranularity);
      const cands = candidateActions(a11y, {
        weights: config.actions.weights,
        blockedSelectors: config.target.blockedSelectors,
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
      let prediction = null;
      let result = { success: false };
      let surpriseResult = null;
      let hardEvidenceOuter = [];

      const recentActions = breadcrumbs
        .all()
        .filter((b) => b.type === 'action')
        .slice(-5)
        .map((b) => b.summary);

      await tracer.startActiveSpan(
        'mcts.expand',
        { attributes: { step, 'state.id': stateId, action: action.type } },
        async (span) => {
          prediction = await predict({ a11yTree: a11y, action, recentActions, llmConfig: config.llm });
          span.setAttribute('llm.prediction', prediction.slice(0, 240));
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
          const observed = await snapshotPage(page.raw).catch(() => null);
          const { signals: hardSignals, evidence: hardEvidence } =
            pageEventsToHardSignals(newEvents);
          hardEvidenceOuter = hardEvidence;
          if (result.latencyMs > config.run.thresholdMs) hardSignals.push('PERF_BREACH');

          surpriseResult = await surprise({
            prediction,
            observed,
            hardSignals,
            llmConfig: config.llm,
          });
          span.setAttribute('surprise.score', surpriseResult.score);
          span.setAttribute('surprise.severity', surpriseResult.severity);
          span.setAttribute('surprise.hard_override', surpriseResult.hardSignalOverride);
          if (surpriseResult.signalType) {
            span.setAttribute('surprise.signal', surpriseResult.signalType);
          }
          span.end();
        },
      );

      backprop(node, surpriseResult.score);

      const currentUrl = page.raw.url();
      const isNoiseLocation = currentUrl === 'about:blank' || currentUrl === '';

      if (
        (surpriseResult.score >= 0.85 || surpriseResult.hardSignalOverride) &&
        !isNoiseLocation
      ) {
        const screenshotBuffer = await page.raw
          .screenshot({ fullPage: true, type: 'png' })
          .catch(() => null);
        const domHtml = await page.raw.content().catch(() => '');
        firstBug = await writeBugReport({
          rootDir: PROJECT_ROOT,
          bugRoot: config.triage?.bugRoot ?? 'BUG',
          seed,
          severity: surpriseResult.severity,
          signal: surpriseResult.signalType ?? surpriseResult.reason ?? 'llm_divergence',
          pageUrl: currentUrl,
          breadcrumbs: breadcrumbs.all(),
          screenshotBuffer,
          domHtml,
          surpriseScore: surpriseResult.score,
          prediction,
          evidence: hardEvidenceOuter,
          tracePath: config.observability?.otel?.path,
          stepsDirRel: path.relative(PROJECT_ROOT, stepsDir),
          config,
        });
        breadcrumbs.record('bug.write', `wrote ${firstBug.folderRel}`);
        if (config.run.stopOnFirstBug) break;
      } else if (
        (surpriseResult.score >= 0.85 || surpriseResult.hardSignalOverride) &&
        isNoiseLocation
      ) {
        breadcrumbs.record(
          'bug.skipped',
          `skipped: page is at "${currentUrl}" (back-from-fresh artifact, not a real bug)`,
        );
      }
    }
  } catch (err) {
    breadcrumbs.record('error', err.message, { stack: err.stack });
    if (!firstBug) {
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
    }
  } finally {
    breadcrumbs.record('run.end', firstBug ? `bug: ${firstBug.folderRel}` : 'no bug found');
    await breadcrumbs.close();
    await browser.close().catch(() => {});
    await shutdownTelemetry();
  }

  if (firstBug) {
    console.log(`\nBUG: ${firstBug.folderRel}`);
    process.exitCode = 0;
  } else {
    console.log(`\nrun ${runId} completed without surfacing a bug.`);
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
