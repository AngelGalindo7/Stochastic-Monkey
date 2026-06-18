// Turn a target URL (or bare host) into a filesystem-safe directory slug.
// Used for per-target output isolation so concurrent runs never collide.
export function slugify(input) {
  let host = input;
  try {
    host = new URL(input).host;
  } catch {
    // not a full URL — treat the input as a host already
  }
  return (
    host
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '-') // strip anything not host-safe
      .replace(/\./g, '-') // dots → dashes for a flat dir name
      .replace(/-+/g, '-') // collapse runs
      .replace(/^-|-$/g, '') || 'target'
  );
}
