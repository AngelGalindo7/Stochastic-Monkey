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
