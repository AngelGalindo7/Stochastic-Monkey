// Stage 4 + 5 — vibe-code fingerprint + enrichment. Pure given inputs (html,
// script bodies, headers); the CLI does the fetching. Detects the platform and
// extracts the Supabase URL + anon key that downstream config/RLS probing wants.

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const SUPABASE_URL_RE = /https?:\/\/([a-z0-9]{16,})\.supabase\.co/i;

export function decodeJwtPayload(jwt) {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// inputs: { url, html, scripts: string[] (JS bodies), headers: {} }
export function fingerprint({ url = '', html = '', scripts = [], headers = {} } = {}) {
  const text = [html, ...scripts].join('\n');
  const signals = [];
  let supabaseUrl = null;
  let anonKey = null;

  const urlMatch = text.match(SUPABASE_URL_RE);
  if (urlMatch) {
    supabaseUrl = `https://${urlMatch[1]}.supabase.co`;
    signals.push('supabase-url');
  }

  if (/\/rest\/v1\//.test(text)) signals.push('postgrest');

  for (const jwt of text.match(JWT_RE) ?? []) {
    const payload = decodeJwtPayload(jwt);
    if (!payload) continue;
    const iss = String(payload.iss ?? '');
    if (payload.role === 'anon' || /supabase/i.test(iss)) {
      anonKey = jwt;
      signals.push('supabase-anon-jwt');
      if (!supabaseUrl) {
        if (payload.ref) supabaseUrl = `https://${payload.ref}.supabase.co`;
        else {
          const im = iss.match(SUPABASE_URL_RE);
          if (im) supabaseUrl = `https://${im[1]}.supabase.co`;
        }
      }
      break;
    }
  }

  let platform = 'unknown';
  const markers = [
    ['lovable', /lovable\.(dev|app)|gptengineer|gpt-engineer/i],
    ['bolt', /bolt\.new|stackblitz\.io/i],
    ['v0', /v0\.dev/i],
    ['base44', /base44/i],
  ];
  for (const [name, re] of markers) {
    if (re.test(text)) {
      platform = name;
      signals.push(`marker:${name}`);
      break;
    }
  }

  if (/\/assets\/index-[A-Za-z0-9_-]+\.js/.test(text)) signals.push('vite-build');

  let score = 0;
  if (signals.includes('supabase-anon-jwt')) score += 0.5;
  if (signals.includes('supabase-url')) score += 0.25;
  if (signals.includes('postgrest')) score += 0.1;
  if (platform !== 'unknown') score += 0.3;
  if (signals.includes('vite-build')) score += 0.1;
  const confidence = Math.min(1, Number(score.toFixed(2)));

  // Supabase present but no named platform → still a vibe-coded backend pattern.
  if (platform === 'unknown' && (supabaseUrl || anonKey)) platform = 'supabase-app';

  return { url, platform, confidence, signals, supabaseUrl, anonKey };
}

// Pull <script src="..."> URLs from HTML, resolved against the page URL.
export function extractScriptSrcs(html, baseUrl) {
  const srcs = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      srcs.push(new URL(m[1], baseUrl).href);
    } catch {
      /* skip bad src */
    }
  }
  return srcs;
}
