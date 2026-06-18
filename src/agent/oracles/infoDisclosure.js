// Per-step info-disclosure oracle. Scans 5xx response bodies captured in the
// current step for patterns that indicate the server is leaking internals:
// stack traces, file paths, DB error messages, credential strings.
//
// Synchronous — examines the already-buffered captures slice for the step.
// Requires network.js to capture text/* bodies for 5xx responses in addition
// to the existing JSON-only capture. See DECISION_LOG 018.

const PATTERNS = [
  { re: /\bat\s+\w[\w.$]*\s*\(.*:\d+:\d+\)/m,          label: 'JS stack trace' },
  { re: /\bat\s+[\w.]+\.[A-Za-z]+\s+\(.*\.java:\d+\)/m, label: 'Java stack trace' },
  { re: /Traceback \(most recent call last\)/i,           label: 'Python traceback' },
  { re: /File ".*", line \d+/i,                          label: 'Python file path' },
  { re: /Warning:.*on line \d+/i,                        label: 'PHP warning' },
  { re: /Fatal error:.*in .* on line \d+/i,              label: 'PHP fatal error' },
  { re: /ORA-\d{5}/,                                     label: 'Oracle DB error' },
  { re: /SQLSTATE\[\w+\]/i,                              label: 'PDO/SQL error code' },
  { re: /PG::[\w]+Error/,                                label: 'Postgres error class' },
  { re: /column "[\w]+" of relation "[\w]+" does not exist/i, label: 'Postgres schema leak' },
  { re: /\/home\/\w+\/|\/var\/www\/|\/usr\/local\/app\//i, label: 'Unix file path' },
  { re: /[A-Z]:\\(?:Users|inetpub|www)\\[^\s"<>]{4,}/i, label: 'Windows file path' },
  { re: /(?:password|db_pass|secret_key|api_key)\s*=\s*\S+/i, label: 'credential string' },
];

export function checkInfoDisclosure(captures) {
  for (const cap of captures) {
    if (cap.status < 500) continue;
    const body =
      typeof cap.responseBody === 'string'
        ? cap.responseBody
        : cap.responseBody != null
          ? JSON.stringify(cap.responseBody)
          : null;
    if (!body) continue;
    for (const { re, label } of PATTERNS) {
      if (re.test(body)) {
        return {
          signal: 'INFO_DISCLOSURE',
          detail: `${label} in ${cap.status} response from ${cap.url}`,
        };
      }
    }
  }
  return { signal: null };
}
