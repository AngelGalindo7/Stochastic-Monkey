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
const fixtures = {
  '/signup': fs.readFileSync(path.join(__dirname, 'fixtures', 'signup-form.html')),
  '/two-forms': fs.readFileSync(path.join(__dirname, 'fixtures', 'two-forms.html')),
};
const PORT = 3098;

const server = http.createServer((req, res) => {
  const body = fixtures[req.url.split('?')[0]] || fixtures['/signup'];
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
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
  await page.goto(`http://localhost:${PORT}/signup`, { waitUntil: 'load' });

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

  // B1 regression: tags from one FORM_FILL must not derail the next form on the page.
  await page.goto(`http://localhost:${PORT}/two-forms`, { waitUntil: 'load' });
  const tf = await detectFillableForms(page);
  assert(tf.length === 2, `two-forms: detected 2 forms (got ${tf.length})`);
  {
    // cycle 1 — only TAG the search form (index 0); do not fill it, so any value that
    // later appears in it must have leaked from the signup cycle (a stale-tag bug).
    await describeForm(page, 0);
  }
  await page.evaluate(() => { window.__signup = undefined; });
  {
    // cycle 2 — fill + submit the signup form (index 1); must NOT hit the search form
    const { fields } = await describeForm(page, 1);
    const { submitted } = await applyFormValues(page, planFormValues(fields, seedrandom('b')));
    assert(submitted === true, 'two-forms: second cycle reported submitted');
  }
  const signup = await page.evaluate(() => window.__signup);
  assert(/@example\.com$/.test(signup?.email || ''), `two-forms: signup submitted with valid email (got ${JSON.stringify(signup)})`);
  const searchVal = await page.evaluate(() => document.querySelector('#search input[name="q"]').value);
  assert(searchVal === '', `two-forms: search field not polluted by the signup fill (got "${searchVal}")`);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — formfill smoke (${failures} failure(s))`);
process.exitCode = failures ? 1 : 0;
