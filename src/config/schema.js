const REQUIRED = {
  target: ['url', 'allowedDomains'],
  run: ['seed', 'maxSteps'],
  actions: ['weights'],
  mcts: ['ucbC'],
};

const ALLOWED_GRANULARITIES = new Set(['fine', 'medium', 'coarse']);
const ALLOWED_OTEL_EXPORTERS = new Set(['file', 'otlp', 'both']);

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

  if (typeof config.run.seed !== 'number') {
    throw new Error('config: run.seed must be a number');
  }
  if (typeof config.run.maxSteps !== 'number' || config.run.maxSteps < 1) {
    throw new Error('config: run.maxSteps must be a positive number');
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

  return config;
}
