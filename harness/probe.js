#!/usr/bin/env node
// Supabase security probes for classified targets.
//
//   node harness/probe.js <targets-jsonl> [options]
//
// For each target with supabaseUrl + anonKey, runs two checks:
//   1. RLS probe  — anon GET /rest/v1/{table}?limit=1 returns real rows?
//   2. BOLA probe — synthetic account B reads a record created by account A?
//
// Both probes use only the publicly embedded anon key and synthetic accounts
// you control. No real user data is read, retained, or logged — only the
// boolean finding (rls_disabled, bolaVulnerable) is written to output.
//
// options:
//   --out PATH        probed-targets output    (default runs/probed-targets.jsonl)
//   --timeout MS      per-request timeout      (default 8000)
//   --concurrency N                            (default 4)
//   --rate-ms MS      per-host spacing         (default 1000)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPool } from './lib/pool.js';
import { makeRateLimiter, hostOf } from './lib/rateLimiter.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .invalid TLD (RFC 2606) — can never resolve to a real mailserver.
export const PROBE_DOMAIN = 'probe.heuristicmonkey.invalid';

function parseArgs(argv) {
  const o = { input: argv[2], out: 'runs/probed-targets.jsonl', timeout: 8000, concurrency: 4, rateMs: 1000 };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else if (a === '--concurrency') o.concurrency = Number(argv[++i]);
    else if (a === '--rate-ms') o.rateMs = Number(argv[++i]);
  }
  return o;
}

// Deterministic probe email. slug + runId prevents collisions on resume.
export function buildProbeEmail(slug, user, runId) {
  return `probe-${user}-${slug.slice(0, 16)}-${runId}@${PROBE_DOMAIN}`;
}

// Extract user-facing table names from a PostgREST OpenAPI spec (GET /rest/v1/).
export function parseOpenApiTables(spec) {
  return Object.keys(spec?.paths ?? {})
    .map((p) => p.replace(/^\//, ''))
    .filter((t) => t && !t.includes('/') && !t.startsWith('rpc') && t !== 'rpc' && t !== '');
}

function anonHeaders(anonKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; stochastic-monkey-probe/1.0)',
  };
}

function authedHeaders(accessToken, anonKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; stochastic-monkey-probe/1.0)',
  };
}

async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function discoverTables(supabaseUrl, anonKey, timeoutMs) {
  try {
    const res = await fetchT(`${supabaseUrl}/rest/v1/`, { headers: anonHeaders(anonKey) }, timeoutMs);
    if (!res.ok) return [];
    return parseOpenApiTables(await res.json());
  } catch {
    return [];
  }
}

// Fallback table names to probe when OpenAPI discovery returns nothing.
const FALLBACK_TABLES = ['profiles', 'users', 'posts', 'todos', 'tasks', 'items', 'notes', 'data', 'records', 'entries'];

// --- RLS probe ---
// Checks whether any table returns rows to an anonymous (unauthenticated) caller
// using only the publicly embedded anon key — the same key every browser gets.
export async function rlsProbe(supabaseUrl, anonKey, tables, timeoutMs) {
  const probeList = tables.length ? tables.slice(0, 12) : FALLBACK_TABLES;
  const exposed = [];
  for (const table of probeList) {
    try {
      const res = await fetchT(
        `${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?limit=1`,
        { headers: { ...anonHeaders(anonKey), Prefer: 'count=none' } },
        timeoutMs,
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && Object.keys(data[0]).length > 0) {
        exposed.push(table);
      }
    } catch {
      /* timeout or network error — skip this table */
    }
  }
  return exposed;
}

// --- BOLA probe ---
// Creates two synthetic accounts using the public signup endpoint.
// Account A creates a record; Account B tries to read it by ID.
// A successful read means RLS ownership check is missing → BOLA.
// All accounts and records are deleted after the test.

async function signup(supabaseUrl, anonKey, email, password, timeoutMs) {
  try {
    const res = await fetchT(
      `${supabaseUrl}/auth/v1/signup`,
      { method: 'POST', headers: anonHeaders(anonKey), body: JSON.stringify({ email, password }) },
      timeoutMs,
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function deleteUser(supabaseUrl, anonKey, accessToken, timeoutMs) {
  // DELETE /auth/v1/user removes the calling user from the Supabase project.
  try {
    await fetchT(
      `${supabaseUrl}/auth/v1/user`,
      { method: 'DELETE', headers: authedHeaders(accessToken, anonKey) },
      timeoutMs,
    );
  } catch { /* best-effort */ }
}

async function deleteRecord(supabaseUrl, anonKey, accessToken, table, recordId, timeoutMs) {
  try {
    await fetchT(
      `${supabaseUrl}/rest/v1/${encodeURIComponent(table)}?id=eq.${encodeURIComponent(String(recordId))}`,
      { method: 'DELETE', headers: authedHeaders(accessToken, anonKey) },
      timeoutMs,
    );
  } catch { /* best-effort */ }
}

export async function bolaProbe(supabaseUrl, anonKey, tables, slug, runId, timeoutMs) {
  const testTable = tables[0];
  if (!testTable) return { tested: false, reason: 'no_table' };

  const password = `Probe!${runId.slice(0, 8)}9Xq`;
  const emailA = buildProbeEmail(slug, 'a', runId);
  const emailB = buildProbeEmail(slug, 'b', runId);

  // Sign up User A. No access_token means the app requires email confirmation —
  // common in production apps but rare in vibe-coded apps. Skip if so.
  const userA = await signup(supabaseUrl, anonKey, emailA, password, timeoutMs);
  if (!userA?.access_token) return { tested: false, reason: 'email_confirm_required' };
  const tokenA = userA.access_token;

  let recordId = null;
  try {
    const res = await fetchT(
      `${supabaseUrl}/rest/v1/${encodeURIComponent(testTable)}`,
      {
        method: 'POST',
        headers: { ...authedHeaders(tokenA, anonKey), Prefer: 'return=representation' },
        body: JSON.stringify({ _probe_marker: true }),
      },
      timeoutMs,
    );
    if (res.ok) {
      const body = await res.json();
      const row = Array.isArray(body) ? body[0] : body;
      recordId = row?.id ?? null;
    }
  } catch { /* table may reject inserts — BOLA not testable on this table */ }

  const userB = await signup(supabaseUrl, anonKey, emailB, password, timeoutMs);
  const tokenB = userB?.access_token ?? null;

  let bolaVulnerable = false;
  if (tokenB && recordId !== null) {
    try {
      const res = await fetchT(
        `${supabaseUrl}/rest/v1/${encodeURIComponent(testTable)}?id=eq.${encodeURIComponent(String(recordId))}`,
        { headers: authedHeaders(tokenB, anonKey) },
        timeoutMs,
      );
      if (res.ok) {
        const data = await res.json();
        bolaVulnerable = Array.isArray(data) && data.length > 0;
      }
    } catch { /* network */ }
  }

  // Cleanup. Failures here don't affect the finding.
  if (recordId !== null) await deleteRecord(supabaseUrl, anonKey, tokenA, testTable, recordId, timeoutMs);
  await deleteUser(supabaseUrl, anonKey, tokenA, timeoutMs);
  if (tokenB) await deleteUser(supabaseUrl, anonKey, tokenB, timeoutMs);

  return { tested: true, table: testTable, bolaVulnerable };
}

// --- Per-target orchestration ---

async function probeTarget(target, runId, timeoutMs) {
  const { url, supabaseUrl, anonKey, slug } = target;
  if (!supabaseUrl || !anonKey) return { ...target, probes: { skipped: true, reason: 'no_supabase' } };

  const tables = await discoverTables(supabaseUrl, anonKey, timeoutMs);
  const exposedTables = await rlsProbe(supabaseUrl, anonKey, tables, timeoutMs);

  // BOLA probe uses exposed tables first (already confirmed reachable); falls
  // back to OpenAPI-discovered tables if RLS was on but app still has writable tables.
  const bolaList = exposedTables.length ? exposedTables : tables;
  const bola = await bolaProbe(
    supabaseUrl, anonKey, bolaList, slug ?? hostOf(url), runId, timeoutMs,
  );

  return {
    ...target,
    probes: {
      rls_disabled: exposedTables.length > 0,
      exposed_tables: exposedTables,
      tables_discovered: tables.length,
      bola,
    },
  };
}

// --- CLI (only runs when executed directly, not when imported by tests) ---

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error('usage: node harness/probe.js <targets-jsonl> [--out PATH] [--timeout MS] [--concurrency N] [--rate-ms MS]');
    process.exit(1);
  }

  const outPath = path.resolve(PROJECT_ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const outStream = fs.createWriteStream(outPath, { flags: 'a' });

  const lines = fs.readFileSync(args.input, 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l.startsWith('{'));
  const targets = lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  console.log(`[probe] ${targets.length} targets → ${path.relative(PROJECT_ROOT, outPath)}`);
  let done = 0; let rlsHits = 0; let bolaHits = 0;

  const rateLimit = makeRateLimiter(args.rateMs);
  const runId = Date.now().toString(36);

  await runPool(
    targets,
    async (t) => {
      await rateLimit(hostOf(t.url));
      const result = await probeTarget(t, runId, args.timeout);
      outStream.write(JSON.stringify(result) + '\n');
      done++;
      if (result.probes?.rls_disabled) rlsHits++;
      if (result.probes?.bola?.bolaVulnerable) bolaHits++;
      if (done % 10 === 0 || done === targets.length) {
        process.stdout.write(`[probe] ${done}/${targets.length}  rls_disabled=${rlsHits}  bola_vulnerable=${bolaHits}\n`);
      }
    },
    {
      concurrency: args.concurrency,
      onError: (err, t) => console.error(`[probe] ERROR ${t.url}: ${err.message}`),
    },
  );

  await new Promise((r) => outStream.end(r));
  console.log(`[probe] done. rls_disabled=${rlsHits}/${done}  bola_vulnerable=${bolaHits}/${done}`);
  process.exit(0);
}
