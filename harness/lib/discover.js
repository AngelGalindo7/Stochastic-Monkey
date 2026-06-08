// Stages 1-2 — acquisition via Certificate Transparency. Pure parsing here;
// the CLI does the crt.sh fetch. CT logs are a passive, high-yield way to
// enumerate the live subdomains under a platform apex (e.g. *.lovable.app).

// Parse crt.sh JSON entries into unique, concrete hostnames scoped to `apex`.
// crt.sh puts one or more names (newline-separated) in name_value, often with
// wildcards — we drop those and keep real hostnames.
export function parseCrtSh(entries, apex = '') {
  const hosts = new Set();
  for (const e of entries ?? []) {
    const fields = [e.name_value, e.common_name].filter(Boolean).join('\n');
    for (const raw of String(fields).split(/\n+/)) {
      const h = raw.trim().toLowerCase();
      if (!h || h.startsWith('*.')) continue; // skip wildcards
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) continue; // sane hostname
      if (apex && h !== apex && !h.endsWith(`.${apex}`)) continue; // scope
      hosts.add(h);
    }
  }
  return [...hosts].sort();
}

export function crtShUrl(apex) {
  return `https://crt.sh/?q=${encodeURIComponent(`%.${apex}`)}&output=json`;
}

// HackerTarget hostsearch — passive DNS, returns "hostname,ip" CSV. Free tier
// caps at ~50 results/query without a key; pass apiKey for more. Resilient when
// crt.sh is down (different infrastructure).
export function hackerTargetUrl(apex, apiKey = null) {
  const base = `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(apex)}`;
  return apiKey ? `${base}&apikey=${encodeURIComponent(apiKey)}` : base;
}

// Parse HackerTarget CSV into hostnames. Non-host lines (rate-limit messages
// like "API count exceeded") fail the hostname regex and are dropped.
export function parseHackerTarget(text, apex = '') {
  const hosts = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const host = line.split(',')[0]?.trim().toLowerCase();
    if (!host || host.startsWith('*.')) continue;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) continue;
    if (apex && !host.endsWith(`.${apex}`)) continue; // subdomains only, drop bare apex
    hosts.add(host);
  }
  return [...hosts].sort();
}

// Wayback Machine CDX — free, no key, high yield. Every archived URL under the
// apex. The biggest free firehose for this. output=json is an array-of-arrays
// whose first row is a header.
export function waybackCdxUrl(apex, limit = 50000) {
  const q = new URLSearchParams({
    url: apex,
    matchType: 'domain',
    fl: 'original',
    collapse: 'urlkey',
    output: 'json',
    limit: String(limit),
  });
  return `https://web.archive.org/cdx/search/cdx?${q.toString()}`;
}

export function parseWaybackCdx(data, apex = '') {
  const rows = typeof data === 'string' ? JSON.parse(data) : data;
  if (!Array.isArray(rows)) return [];
  const hosts = new Set();
  for (const row of rows) {
    const original = Array.isArray(row) ? row[0] : row;
    if (!original || original === 'original') continue; // header row
    let host;
    try {
      host = new URL(original).host.toLowerCase();
    } catch {
      continue;
    }
    if (!host || host.startsWith('*.')) continue;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) continue;
    if (apex && !host.endsWith(`.${apex}`)) continue; // subdomains only, drop bare apex
    hosts.add(host);
  }
  return [...hosts].sort();
}

// RapidDNS — free, no key. HTML page listing subdomains; scrape hostnames.
export function rapidDnsUrl(apex) {
  return `https://rapiddns.io/subdomain/${encodeURIComponent(apex)}?full=1`;
}

export function parseRapidDns(html, apex = '') {
  if (!apex) return [];
  const hosts = new Set();
  const re = new RegExp(`[a-z0-9_-]+(?:\\.[a-z0-9_-]+)*\\.${apex.replace(/\./g, '\\.')}`, 'gi');
  for (const m of String(html).matchAll(re)) {
    const host = m[0].toLowerCase();
    if (host.startsWith('*.') || host === apex) continue;
    hosts.add(host);
  }
  return [...hosts].sort();
}
