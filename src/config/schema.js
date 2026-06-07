const REQUIRED = {
  target: ['url', 'allowedDomains'],
  run: ['seed', 'maxSteps'],
  actions: ['weights'],
  mcts: ['ucbC'],
};

const ALLOWED_GRANULARITIES = new Set(['fine', 'medium', 'coarse']);
const ALLOWED_OTEL_EXPORTERS = new Set(['file', 'otlp', 'both']);
const ALLOWED_ENGINES = new Set(['puppeteer', 'playwright']);

export function validate(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('config: root must be an object');
  }
  for (const [section, keys] of Object.entries(REQUIRED)) {
    if (!config[section]) throw new Error(`config: missing section "${section}"`);
    for (const key of keys) {
      if (config[section][key] === undefined || config[section][key] === null) {
        throw new Error(`config: missing required field "${section}.${key}"`);
      }
    }
  }

  const url = config.target.url;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('config: target.url must be an http(s) URL');
  }

  const domains = config.target.allowedDomains;
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new Error('config: target.allowedDomains must be a non-empty array');
  }

  const weights = config.actions.weights;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error('config: actions.weights must sum to > 0');

  if (config.mcts.abstractionGranularity &&
      !ALLOWED_GRANULARITIES.has(config.mcts.abstractionGranularity)) {
    throw new Error(`config: mcts.abstractionGranularity must be one of ${[...ALLOWED_GRANULARITIES].join(', ')}`);
  }

  const exporter = config.observability?.otel?.exporter;
  if (exporter !== undefined && !ALLOWED_OTEL_EXPORTERS.has(exporter)) {
    throw new Error(`config: observability.otel.exporter must be one of ${[...ALLOWED_OTEL_EXPORTERS].join(', ')}`);
  }

  if (config.novelty?.nameDenylist !== undefined) {
    if (!Array.isArray(config.novelty.nameDenylist)) {
      throw new Error('config: novelty.nameDenylist must be an array of regex strings if provided');
    }
    for (const [i, pat] of config.novelty.nameDenylist.entries()) {
      if (typeof pat !== 'string') {
        throw new Error(`config: novelty.nameDenylist[${i}] must be a string`);
      }
      try {
        new RegExp(pat);
      } catch {
        throw new Error(`config: novelty.nameDenylist[${i}] is not a valid regex: ${pat}`);
      }
    }
  }

  if (typeof config.run.seed !== 'number') {
    throw new Error('config: run.seed must be a number');
  }
  if (typeof config.run.maxSteps !== 'number' || config.run.maxSteps < 1) {
    throw new Error('config: run.maxSteps must be a positive number');
  }

  if (config.actions.filesPool !== undefined) {
    if (!Array.isArray(config.actions.filesPool)) {
      throw new Error('config: actions.filesPool must be an array if provided');
    }
    for (const [i, entry] of config.actions.filesPool.entries()) {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`config: actions.filesPool[${i}] must be an object`);
      }
      if (typeof entry.path !== 'string' || !entry.path.length) {
        throw new Error(`config: actions.filesPool[${i}] requires string "path"`);
      }
    }
  }

  if (config.auth?.cookies !== undefined) {
    if (!Array.isArray(config.auth.cookies)) {
      throw new Error('config: auth.cookies must be an array if provided');
    }
    for (const [i, cookie] of config.auth.cookies.entries()) {
      if (!cookie || typeof cookie !== 'object') {
        throw new Error(`config: auth.cookies[${i}] must be an object`);
      }
      if (!cookie.name || typeof cookie.value !== 'string') {
        throw new Error(`config: auth.cookies[${i}] requires "name" and string "value"`);
      }
      if (!cookie.domain && !cookie.url) {
        throw new Error(`config: auth.cookies[${i}] requires either "domain" or "url"`);
      }
    }
  }

  if (config.auth?.localStorage !== undefined) {
    if (!config.auth.localStorage || typeof config.auth.localStorage !== 'object' || Array.isArray(config.auth.localStorage)) {
      throw new Error('config: auth.localStorage must be an object map of string keys to string values');
    }
    for (const [k, v] of Object.entries(config.auth.localStorage)) {
      if (typeof v !== 'string') {
        throw new Error(`config: auth.localStorage["${k}"] must be a string`);
      }
    }
  }

  if (config.browser?.engine !== undefined && !ALLOWED_ENGINES.has(config.browser.engine)) {
    throw new Error(`config: browser.engine must be one of ${[...ALLOWED_ENGINES].join(', ')}`);
  }

  if (config.browser?.storageState !== undefined && typeof config.browser.storageState !== 'string') {
    throw new Error('config: browser.storageState must be a string path if provided');
  }

  if (config.auth?.persistSession !== undefined && typeof config.auth.persistSession !== 'boolean') {
    throw new Error('config: auth.persistSession must be a boolean if provided');
  }

  if (config.auth?.refreshUrl !== undefined) {
    if (typeof config.auth.refreshUrl !== 'string' || !/^https?:\/\//i.test(config.auth.refreshUrl)) {
      throw new Error('config: auth.refreshUrl must be an http(s) URL if provided');
    }
  }

  if (config.auth?.login !== undefined) {
    const login = config.auth.login;
    if (!login || typeof login !== 'object' || Array.isArray(login)) {
      throw new Error('config: auth.login must be an object if provided');
    }
    if (typeof login.url !== 'string' || !/^https?:\/\//i.test(login.url)) {
      throw new Error('config: auth.login.url must be an http(s) URL');
    }
    if (typeof login.email !== 'string' || !login.email.length) {
      throw new Error('config: auth.login.email must be a non-empty string');
    }
    if (typeof login.password !== 'string' || !login.password.length) {
      throw new Error('config: auth.login.password must be a non-empty string');
    }
  }

  return config;
}
