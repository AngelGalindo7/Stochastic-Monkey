import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { validate } from './schema.js';

const ENV_OVERRIDE_MAP = {
  HEURISTIC_TARGET_URL: ['target', 'url'],
  HEURISTIC_SEED: ['run', 'seed'],
  HEURISTIC_MAX_STEPS: ['run', 'maxSteps'],
  HEURISTIC_LLM_MODEL: ['llm', 'model'],
  HEURISTIC_LLM_ENABLED: ['llm', 'enabled'],
};

const NUMERIC_PATHS = new Set(['run.seed', 'run.maxSteps']);
const BOOLEAN_PATHS = new Set(['llm.enabled']);

function setIn(obj, pathArr, value) {
  let cursor = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const k = pathArr[i];
    cursor[k] ??= {};
    cursor = cursor[k];
  }
  cursor[pathArr[pathArr.length - 1]] = value;
}

function coerce(pathStr, raw) {
  if (NUMERIC_PATHS.has(pathStr)) return Number(raw);
  if (BOOLEAN_PATHS.has(pathStr)) return raw === 'true' || raw === '1';
  return raw;
}

function applyEnvOverrides(cfg, env) {
  for (const [envKey, pathArr] of Object.entries(ENV_OVERRIDE_MAP)) {
    if (env[envKey] !== undefined && env[envKey] !== '') {
      setIn(cfg, pathArr, coerce(pathArr.join('.'), env[envKey]));
    }
  }
  return cfg;
}

function substituteRunId(cfg, runId) {
  function walk(obj) {
    if (typeof obj !== 'object' || obj === null) return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        obj[k] = v.replace(/\$\{RUN_ID\}/g, runId);
      } else if (typeof v === 'object') {
        walk(v);
      }
    }
  }
  walk(cfg);
  return cfg;
}

export function loadConfig({ configPath, env = process.env, runId = null } = {}) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`config: file not found at ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = YAML.parse(raw);
  applyEnvOverrides(parsed, env);
  if (runId) substituteRunId(parsed, runId);
  return validate(parsed);
}
