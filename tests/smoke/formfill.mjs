// Real-browser smoke for FORM_FILL. Drives perception/forms.js + actions/formPlan.js
// against a realistic signup form and asserts the captured submission carries valid,
// constraint-respecting data. Usage: node tests/smoke/formfill.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import seedrandom from 'seedrandom';
import { detectFillableForms, describeForm, applyFormValues } from '../../src/perception/forms.js';
import { planFormValues } from '../../src/actions/formPlan.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'signup-form.html'));
const PORT = 3098;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fixture);
});
await new Promise((r) => server.listen(PORT, r));

let failures = 0;
const assert = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

  const forms = await detectFillableForms(page);
  assert(forms.length === 1, `detected exactly one fillable form (got ${forms.length})`);
  assert(forms[0]?.fieldCount >= 6, `form has >= 6 fillable fields (got ${forms[0]?.fieldCount})`);
  assert(forms[0]?.hasSubmit === true, 'form has a submit button');

  const { fields } = await describeForm(page, 0);
  assert(fields.length >= 6, `described >= 6 fields (got ${fields.length})`);

  const plan = planFormValues(fields, seedrandom('42'));
  const { filled, submitted } = await applyFormValues(page, plan);
  assert(filled >= 6, `filled >= 6 fields (got ${filled})`);
  assert(submitted === true, 'submitted the form');

  const sub = await page.evaluate(() => window.__submitted);
  assert(!!sub, 'form submit handler captured values');
  assert(/@example\.com$/.test(sub?.email || ''), `valid email submitted (${sub?.email})`);
  assert((sub?.password || '').length >= 8, `password meets minlength 8 (${sub?.password})`);
  assert(sub?.password === sub?.confirmPassword, 'confirm-password matches password');
  assert((sub?.fullName || '').length > 0, `full name filled (${sub?.fullName})`);
  assert(sub?.country === 'us', `country selected a real option (${sub?.country})`);
  assert(Number(sub?.age) >= 18 && Number(sub?.age) <= 120, `age within min/max (${sub?.age})`);
  assert(sub?.__tosChecked === true, 'required terms checkbox checked');
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — formfill smoke (${failures} failure(s))`);
process.exitCode = failures ? 1 : 0;
