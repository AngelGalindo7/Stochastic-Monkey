import { describe, it, expect } from 'vitest';
import { checkInfoDisclosure } from '../../src/agent/oracles/infoDisclosure.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cap(status, responseBody, url = 'https://example.com/api') {
  return { status, responseBody, url };
}

// ---------------------------------------------------------------------------
// Silent paths
// ---------------------------------------------------------------------------

describe('checkInfoDisclosure — silent', () => {
  it('returns null for empty captures', () => {
    expect(checkInfoDisclosure([]).signal).toBeNull();
  });

  it('skips captures with status < 500 (4xx and 2xx)', () => {
    expect(checkInfoDisclosure([cap(404, 'Not found'), cap(200, 'OK')]).signal).toBeNull();
  });

  it('skips a 5xx capture with null responseBody', () => {
    expect(checkInfoDisclosure([cap(500, null)]).signal).toBeNull();
  });

  it('skips a 5xx capture with empty string body', () => {
    expect(checkInfoDisclosure([cap(500, '')]).signal).toBeNull();
  });

  it('returns null when 5xx body has no matching pattern', () => {
    expect(checkInfoDisclosure([cap(500, 'Internal server error — please try again')]).signal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fires INFO_DISCLOSURE — string bodies
// ---------------------------------------------------------------------------

describe('checkInfoDisclosure — string body patterns', () => {
  it('detects a JS stack trace', () => {
    const body = 'Error\n    at Object.<anonymous> (app.js:12:5)\n    at Module._compile (node:internal/modules/cjs/loader:1364:14)';
    const r = checkInfoDisclosure([cap(500, body)]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/JS stack trace/);
  });

  it('detects a Java stack trace', () => {
    const body = '    at com.example.service.UserService.create (UserService.java:42)';
    const r = checkInfoDisclosure([cap(500, body)]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/Java stack trace/);
  });

  it('detects a Python traceback header', () => {
    const body = 'Traceback (most recent call last):\n  File "/app/main.py", line 10';
    const r = checkInfoDisclosure([cap(500, body)]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/Python traceback/);
  });

  it('detects a Python file path line', () => {
    const body = '  File "/var/www/app/views.py", line 55, in get_user';
    const r = checkInfoDisclosure([cap(500, body)]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/Python file path/);
  });

  it('detects a PHP warning', () => {
    const body = 'Warning: Division by zero in /var/www/html/index.php on line 23';
    const r = checkInfoDisclosure([cap(500, body)]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/PHP warning/);
  });

  it('detects a PHP fatal error', () => {
    const body = 'Fatal error: Uncaught TypeError in /app/index.php on line 99';
    const r = checkInfoDisclosure([cap(500, body)]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/PHP fatal error/);
  });

  it('detects an Oracle DB error code', () => {
    const r = checkInfoDisclosure([cap(500, 'ORA-00942: table or view does not exist')]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/Oracle DB error/);
  });

  it('detects a PDO SQL error code', () => {
    const r = checkInfoDisclosure([cap(500, 'SQLSTATE[23000]: Integrity constraint violation')]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/PDO\/SQL error code/);
  });

  it('detects a Postgres error class', () => {
    const r = checkInfoDisclosure([cap(500, 'PG::UndefinedColumnError: ERROR: column "foo" does not exist')]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/Postgres error class/);
  });

  it('detects a Postgres schema leak', () => {
    const body = 'column "user_id" of relation "orders" does not exist';
    const r = checkInfoDisclosure([cap(500, body)]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/Postgres schema leak/);
  });

  it('detects a Unix file path', () => {
    const r = checkInfoDisclosure([cap(500, 'Error reading /home/ubuntu/app/config.js')]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/Unix file path/);
  });

  it('detects a Windows file path', () => {
    const r = checkInfoDisclosure([cap(500, 'Error at C:\\Users\\app\\server\\index.js line 5')]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/Windows file path/);
  });

  it('detects a credential string', () => {
    const r = checkInfoDisclosure([cap(500, 'db_pass=super$ecret123 failed to connect')]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/credential string/);
  });
});

// ---------------------------------------------------------------------------
// Object responseBody — JSON-stringified
// ---------------------------------------------------------------------------

describe('checkInfoDisclosure — object body', () => {
  it('JSON-stringifies object body and matches patterns', () => {
    const body = { error: 'ORA-00942: table does not exist', code: 500 };
    const r = checkInfoDisclosure([cap(500, body)]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/Oracle DB error/);
  });

  it('returns null when JSON body has no matching pattern', () => {
    const r = checkInfoDisclosure([cap(500, { message: 'something went wrong' })]);
    expect(r.signal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Detail format and URL attribution
// ---------------------------------------------------------------------------

describe('checkInfoDisclosure — detail format', () => {
  it('includes the matching label, status code, and URL in the detail', () => {
    const url = 'https://api.example.com/v1/items';
    const body = 'ORA-00942: table or view does not exist';
    const r = checkInfoDisclosure([cap(500, body, url)]);
    expect(r.detail).toMatch(/Oracle DB error/);
    expect(r.detail).toMatch(/500/);
    expect(r.detail).toMatch(url);
  });

  it('returns on the first matching capture when multiple 5xx are present', () => {
    const first = cap(500, 'ORA-00942: first', 'https://example.com/first');
    const second = cap(502, 'SQLSTATE[23000]: second', 'https://example.com/second');
    const r = checkInfoDisclosure([first, second]);
    expect(r.detail).toMatch(/Oracle DB error/);
    expect(r.detail).toMatch(/first/);
  });

  it('skips non-5xx before a matching 5xx', () => {
    const noise = cap(200, 'ORA-00942: should be ignored');
    const real = cap(500, 'ORA-00942: should fire');
    const r = checkInfoDisclosure([noise, real]);
    expect(r.signal).toBe('INFO_DISCLOSURE');
    expect(r.detail).toMatch(/Oracle DB error/);
  });
});
