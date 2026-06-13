import { describe, it, expect } from 'vitest';
import { validate } from '../../src/config/schema.js';

const BASE = {
  target: { url: 'https://example.com', allowedDomains: ['example.com'] },
  run: { seed: 42, maxSteps: 10 },
  actions: { weights: { CLICK: 1 } },
  mcts: { ucbC: 1.4 },
};

function base(overrides = {}) {
  return JSON.parse(JSON.stringify({ ...BASE, ...overrides }));
}

describe('schema.validate — happy path', () => {
  it('returns config unchanged when valid', () => {
    const cfg = base();
    expect(validate(cfg)).toBe(cfg);
  });
});

describe('schema.validate — root shape', () => {
  it('throws when config is null', () => {
    expect(() => validate(null)).toThrow('root must be an object');
  });

  it('throws when config is a string', () => {
    expect(() => validate('bad')).toThrow('root must be an object');
  });
});

describe('schema.validate — missing required sections', () => {
  for (const section of ['target', 'run', 'actions', 'mcts']) {
    it(`throws when section "${section}" is missing`, () => {
      const cfg = base();
      delete cfg[section];
      expect(() => validate(cfg)).toThrow(`missing section "${section}"`);
    });
  }
});

describe('schema.validate — missing required fields', () => {
  it('throws when target.url is missing', () => {
    const cfg = base();
    delete cfg.target.url;
    expect(() => validate(cfg)).toThrow('missing required field "target.url"');
  });

  it('throws when target.allowedDomains is missing', () => {
    const cfg = base();
    delete cfg.target.allowedDomains;
    expect(() => validate(cfg)).toThrow('missing required field "target.allowedDomains"');
  });

  it('throws when run.seed is missing', () => {
    const cfg = base();
    delete cfg.run.seed;
    expect(() => validate(cfg)).toThrow('missing required field "run.seed"');
  });

  it('throws when mcts.ucbC is missing', () => {
    const cfg = base();
    delete cfg.mcts.ucbC;
    expect(() => validate(cfg)).toThrow('missing required field "mcts.ucbC"');
  });
});

describe('schema.validate — target.url', () => {
  it('throws on non-http URL', () => {
    const cfg = base();
    cfg.target.url = 'ftp://bad.com';
    expect(() => validate(cfg)).toThrow('target.url must be an http(s) URL');
  });

  it('throws when url is not a string', () => {
    const cfg = base();
    cfg.target.url = 123;
    expect(() => validate(cfg)).toThrow('target.url must be an http(s) URL');
  });

  it('accepts http url', () => {
    const cfg = base();
    cfg.target.url = 'http://localhost:3000';
    expect(() => validate(cfg)).not.toThrow();
  });
});

describe('schema.validate — target.allowedDomains', () => {
  it('throws when allowedDomains is empty', () => {
    const cfg = base();
    cfg.target.allowedDomains = [];
    expect(() => validate(cfg)).toThrow('must be a non-empty array');
  });

  it('throws when allowedDomains is not an array', () => {
    const cfg = base();
    cfg.target.allowedDomains = 'example.com';
    expect(() => validate(cfg)).toThrow('must be a non-empty array');
  });
});

describe('schema.validate — actions.weights', () => {
  it('throws when weights sum to zero', () => {
    const cfg = base();
    cfg.actions.weights = { CLICK: 0 };
    expect(() => validate(cfg)).toThrow('actions.weights must sum to > 0');
  });
});

describe('schema.validate — run fields', () => {
  it('throws when seed is not a number', () => {
    const cfg = base();
    cfg.run.seed = '42';
    expect(() => validate(cfg)).toThrow('run.seed must be a number');
  });

  it('throws when maxSteps is zero', () => {
    const cfg = base();
    cfg.run.maxSteps = 0;
    expect(() => validate(cfg)).toThrow('run.maxSteps must be a positive number');
  });

  it('throws when maxSteps is not a number', () => {
    const cfg = base();
    cfg.run.maxSteps = '10';
    expect(() => validate(cfg)).toThrow('run.maxSteps must be a positive number');
  });
});

describe('schema.validate — mcts.abstractionGranularity', () => {
  it('throws on invalid granularity', () => {
    const cfg = base();
    cfg.mcts.abstractionGranularity = 'pixel';
    expect(() => validate(cfg)).toThrow('mcts.abstractionGranularity must be one of');
  });

  it('accepts valid granularities', () => {
    for (const g of ['fine', 'medium', 'coarse']) {
      const cfg = base();
      cfg.mcts.abstractionGranularity = g;
      expect(() => validate(cfg)).not.toThrow();
    }
  });
});

describe('schema.validate — observability.otel.exporter', () => {
  it('throws on unknown exporter', () => {
    const cfg = base();
    cfg.observability = { otel: { exporter: 'stdout' } };
    expect(() => validate(cfg)).toThrow('observability.otel.exporter must be one of');
  });

  it('accepts file, otlp, both', () => {
    for (const e of ['file', 'otlp', 'both']) {
      const cfg = base();
      cfg.observability = { otel: { exporter: e } };
      expect(() => validate(cfg)).not.toThrow();
    }
  });
});

describe('schema.validate — novelty.nameDenylist', () => {
  it('throws when not an array', () => {
    const cfg = base();
    cfg.novelty = { nameDenylist: 'bad' };
    expect(() => validate(cfg)).toThrow('novelty.nameDenylist must be an array');
  });

  it('throws when entry is not a string', () => {
    const cfg = base();
    cfg.novelty = { nameDenylist: [123] };
    expect(() => validate(cfg)).toThrow('must be a string');
  });

  it('throws when entry is an invalid regex', () => {
    const cfg = base();
    cfg.novelty = { nameDenylist: ['[invalid'] };
    expect(() => validate(cfg)).toThrow('is not a valid regex');
  });

  it('accepts valid regex strings', () => {
    const cfg = base();
    cfg.novelty = { nameDenylist: ['^login', 'signup$'] };
    expect(() => validate(cfg)).not.toThrow();
  });
});

describe('schema.validate — actions.filesPool', () => {
  it('throws when not an array', () => {
    const cfg = base();
    cfg.actions.filesPool = 'bad';
    expect(() => validate(cfg)).toThrow('actions.filesPool must be an array');
  });

  it('throws when entry has no path', () => {
    const cfg = base();
    cfg.actions.filesPool = [{ name: 'test.pdf' }];
    expect(() => validate(cfg)).toThrow('requires string "path"');
  });

  it('accepts valid filesPool', () => {
    const cfg = base();
    cfg.actions.filesPool = [{ path: '/tmp/test.pdf' }];
    expect(() => validate(cfg)).not.toThrow();
  });
});

describe('schema.validate — auth.cookies', () => {
  it('throws when not an array', () => {
    const cfg = base();
    cfg.auth = { cookies: 'bad' };
    expect(() => validate(cfg)).toThrow('auth.cookies must be an array');
  });

  it('throws when cookie has no name', () => {
    const cfg = base();
    cfg.auth = { cookies: [{ value: 'x', domain: 'example.com' }] };
    expect(() => validate(cfg)).toThrow('requires "name" and string "value"');
  });

  it('throws when cookie has no domain or url', () => {
    const cfg = base();
    cfg.auth = { cookies: [{ name: 'tok', value: 'x' }] };
    expect(() => validate(cfg)).toThrow('requires either "domain" or "url"');
  });

  it('accepts valid cookie with domain', () => {
    const cfg = base();
    cfg.auth = { cookies: [{ name: 'tok', value: 'abc', domain: 'example.com' }] };
    expect(() => validate(cfg)).not.toThrow();
  });
});

describe('schema.validate — auth.localStorage', () => {
  it('throws when not an object', () => {
    const cfg = base();
    cfg.auth = { localStorage: ['bad'] };
    expect(() => validate(cfg)).toThrow('must be an object map');
  });

  it('throws when value is not a string', () => {
    const cfg = base();
    cfg.auth = { localStorage: { key: 123 } };
    expect(() => validate(cfg)).toThrow('must be a string');
  });

  it('accepts valid localStorage map', () => {
    const cfg = base();
    cfg.auth = { localStorage: { token: 'abc' } };
    expect(() => validate(cfg)).not.toThrow();
  });
});

describe('schema.validate — browser settings', () => {
  it('throws on unknown browser engine', () => {
    const cfg = base();
    cfg.browser = { engine: 'firefox' };
    expect(() => validate(cfg)).toThrow('browser.engine must be one of');
  });

  it('accepts puppeteer and playwright engines', () => {
    for (const e of ['puppeteer', 'playwright']) {
      const cfg = base();
      cfg.browser = { engine: e };
      expect(() => validate(cfg)).not.toThrow();
    }
  });

  it('throws when storageState is not a string', () => {
    const cfg = base();
    cfg.browser = { storageState: 123 };
    expect(() => validate(cfg)).toThrow('browser.storageState must be a string path');
  });
});

describe('schema.validate — auth.login', () => {
  it('throws when login url is not http', () => {
    const cfg = base();
    cfg.auth = { login: { url: 'ftp://bad', email: 'a@b.com', password: 'pw' } };
    expect(() => validate(cfg)).toThrow('auth.login.url must be an http(s) URL');
  });

  it('throws when login email is empty', () => {
    const cfg = base();
    cfg.auth = { login: { url: 'https://x.com/login', email: '', password: 'pw' } };
    expect(() => validate(cfg)).toThrow('auth.login.email must be a non-empty string');
  });

  it('accepts valid login block', () => {
    const cfg = base();
    cfg.auth = { login: { url: 'https://x.com/login', email: 'a@b.com', password: 'pw' } };
    expect(() => validate(cfg)).not.toThrow();
  });
});

describe('schema.validate — auth.roles', () => {
  it('accepts null (anon) role value', () => {
    const cfg = base();
    cfg.auth = { roles: { anon: null } };
    expect(() => validate(cfg)).not.toThrow();
  });

  it('accepts valid object role value', () => {
    const cfg = base();
    cfg.auth = { roles: { user: { cookies: [{ name: 'tok', value: 'x', domain: 'example.com' }] } } };
    expect(() => validate(cfg)).not.toThrow();
  });

  it('throws when auth.roles is not an object', () => {
    const cfg = base();
    cfg.auth = { roles: 'bad' };
    expect(() => validate(cfg)).toThrow('auth.roles must be an object map');
  });

  it('throws when a role entry is an array', () => {
    const cfg = base();
    cfg.auth = { roles: { user: ['bad'] } };
    expect(() => validate(cfg)).toThrow('must be an object or null');
  });

  it('throws when a role entry has an invalid login url (exercises validateAuthBlock recursion)', () => {
    const cfg = base();
    cfg.auth = { roles: { admin: { login: { url: 'ftp://bad', email: 'a@b.com', password: 'pw' } } } };
    expect(() => validate(cfg)).toThrow('login.url must be an http(s) URL');
  });
});
