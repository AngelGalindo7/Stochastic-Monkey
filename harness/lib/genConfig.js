import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

// Render a per-target config.yaml from the passive template.
//
// Fills the four per-target slots the template leaves open:
//   - target.url
//   - target.allowedDomains  (target host + any API/Supabase host from enrichment)
//   - run.seed
//   - triage.bugRoot + the two observability paths (ALL absolute, per-target)
//
// Absolute bugRoot is deliberate: triage.js resolves it with
// path.resolve(PROJECT_ROOT, bugRoot), and path.resolve ignores PROJECT_ROOT when
// the second arg is absolute. So the harness fully owns each target's output dir
// and two runs never collide even with the same seed + timestamp.
export function generateConfig({ target, runDir, templatePath, seed = 42 }) {
  const tpl = YAML.parse(fs.readFileSync(templatePath, 'utf8'));

  const url = target.url;
  const host = new URL(url).host;

  const allowed = new Set([host]);
  if (target.supabaseUrl) {
    try {
      allowed.add(new URL(target.supabaseUrl).host);
    } catch {
      /* ignore malformed enrichment */
    }
  }
  for (const d of target.allowedDomains ?? []) allowed.add(d);

  const bugRoot = path.resolve(runDir, 'BUG');

  tpl.target.url = url;
  tpl.target.allowedDomains = [...allowed];
  tpl.run.seed = seed;
  tpl.triage = tpl.triage ?? {};
  tpl.triage.bugRoot = bugRoot;

  // Keep the literal ${RUN_ID} token — the monkey's loader substitutes it at
  // load time. We only fix the absolute prefix here.
  tpl.observability = tpl.observability ?? {};
  tpl.observability.otel = {
    ...(tpl.observability.otel ?? {}),
    path: path.join(bugRoot, '${RUN_ID}', 'trace.jsonl'),
  };
  tpl.observability.breadcrumbs = {
    ...(tpl.observability.breadcrumbs ?? {}),
    path: path.join(bugRoot, '${RUN_ID}', 'breadcrumbs.jsonl'),
  };

  fs.mkdirSync(runDir, { recursive: true });
  const cfgPath = path.join(runDir, 'config.yaml');
  fs.writeFileSync(cfgPath, YAML.stringify(tpl));

  return { cfgPath, bugRoot };
}
