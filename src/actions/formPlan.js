// Deterministic, seeded form-value planner — the heart of FORM_FILL.
//
// Pure function: given the field descriptors of a form (from perception/forms.js)
// and the run's seeded rng, produce a plan of (field, op, value) that fills every
// field with type-appropriate VALID data so the form passes client validation and
// the submit triggers a real backend write — the prerequisite for the STATE_* and
// authz oracles to ever fire (the "reachability" gap; random input rarely submits a
// valid form).
//
// No Math.random / Date — all variation comes from the passed seeded rng, so the
// same seed reproduces the same fills (the project's reproducibility contract).
// No DOM here; this is unit-tested in isolation.

const int = (rng, n) => Math.floor(rng() * n);

// Normalize field metadata into a keyword haystack: split camelCase
// (confirmPassword → "confirm password") and treat _ / - as separators
// (last_name → "last name") so name conventions across apps match the same rules.
function normalizeHay(parts) {
  return parts
    .filter(Boolean)
    .join(' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function makeEmail(rng) {
  return `monkey${int(rng, 1_000_000)}@example.com`;
}

// Meets the common policy: >= 8 chars, upper + lower + digit + symbol.
function makePassword(rng) {
  return `Aa1!${int(rng, 100_000_000)}`;
}

function makePhone(rng) {
  return `+1555${String(int(rng, 10_000_000)).padStart(7, '0')}`;
}

function numberInRange(f, rng) {
  const min = f.min !== null && f.min !== '' ? Number(f.min) : null;
  const max = f.max !== null && f.max !== '' ? Number(f.max) : null;
  const step = f.step && f.step !== 'any' ? Number(f.step) || 1 : 1;
  let base = min != null ? min : 1;
  if (min != null && max != null && max >= min) {
    const span = Math.floor((max - min) / step);
    base = min + (span > 0 ? int(rng, span + 1) * step : 0);
  }
  if (min != null && base < min) base = min;
  if (max != null && base > max) base = max;
  return String(base);
}

function dateValue(type, f) {
  const clamp = (def) => {
    if (f.min && def < f.min) return f.min;
    if (f.max && def > f.max) return f.max;
    return def;
  };
  switch (type) {
    case 'datetime-local': return clamp('2020-06-15T12:00');
    case 'month': return clamp('2020-06');
    case 'week': return '2020-W25';
    case 'time': return '12:00';
    default: return clamp('2020-06-15');
  }
}

// Keyword-driven valid text for fields that aren't a structural type. Ordered most-
// specific first. Returns plausible, format-clean values (no XSS/SQLi payloads — that
// is the single-field INPUT action's job; FORM_FILL's job is to get past validation).
function semanticText(hay, rng) {
  if (/\b(first\s*name|given\s*name|fname)\b/.test(hay)) return 'Test';
  if (/\b(last\s*name|surname|family\s*name|lname)\b/.test(hay)) return 'User';
  if (/\b(user\s*name|handle|login|nickname|nick)\b/.test(hay)) return `testuser${int(rng, 100_000)}`;
  if (/\b(full\s*name|your\s*name|display\s*name|name)\b/.test(hay)) return 'Test User';
  if (/\b(company|organi[sz]ation|business|employer)\b/.test(hay)) return 'Test Co';
  if (/\b(street|address|addr|line\s*1|line1)\b/.test(hay)) return '123 Main St';
  if (/\b(city|town|locality)\b/.test(hay)) return 'Springfield';
  if (/\b(state|province|region)\b/.test(hay)) return 'CA';
  if (/\b(zip|postal|postcode|post\s*code)\b/.test(hay)) return '94016';
  if (/\bcountry\b/.test(hay)) return 'US';
  if (/\b(title|subject|headline)\b/.test(hay)) return 'Test title';
  if (/\b(description|message|comment|body|content|bio|about|notes?|details?|review)\b/.test(hay)) {
    return 'This is a test entry created by an automated check.';
  }
  if (/\b(age|years?\s*old)\b/.test(hay)) return '30';
  if (/\b(price|amount|cost|budget|salary|fee|total)\b/.test(hay)) return '10';
  if (/\b(quantity|qty|count)\b/.test(hay)) return '1';
  if (/\b(code|coupon|promo|voucher|otp|pin|token)\b/.test(hay)) return '123456';
  if (/\b(slug|subdomain)\b/.test(hay)) return `test${int(rng, 100_000)}`;
  return 'Test';
}

// Returns { value, structured } — structured values (email/password/number/...) are
// never length-clamped because truncation would break their format.
function textValueFor({ type, hay, f, rng, ctx }) {
  const isConfirm = /(confirm|repeat|verif|re\s*enter|re\s*type)/.test(hay);

  if (type === 'password' || /\b(password|passwd|passcode|pwd)\b/.test(hay)) {
    if (isConfirm && ctx.lastPassword) return { value: ctx.lastPassword, structured: true };
    ctx.lastPassword = makePassword(rng);
    return { value: ctx.lastPassword, structured: true };
  }
  if (type === 'email' || /\be-?mail\b/.test(hay)) {
    if (isConfirm && ctx.lastEmail) return { value: ctx.lastEmail, structured: true };
    ctx.lastEmail = makeEmail(rng);
    return { value: ctx.lastEmail, structured: true };
  }
  if (type === 'tel' || /\b(phone|tel|mobile|cell)\b/.test(hay)) return { value: makePhone(rng), structured: true };
  if (type === 'url' || /\b(url|website|web\s*site|homepage)\b/.test(hay)) return { value: 'https://example.com', structured: true };
  if (type === 'number' || type === 'range' || f.inputmode === 'numeric' || f.inputmode === 'decimal') {
    return { value: numberInRange(f, rng), structured: true };
  }
  if (['date', 'datetime-local', 'month', 'week', 'time'].includes(type)) {
    return { value: dateValue(type, f), structured: true };
  }
  if (type === 'color') return { value: '#3366cc', structured: true };
  if (type === 'search' || /\bsearch\b/.test(hay)) return { value: 'test', structured: false };
  return { value: semanticText(hay, rng), structured: false };
}

function clampText(value, f) {
  let v = value;
  if (f.maxLength && f.maxLength > 0 && v.length > f.maxLength) v = v.slice(0, f.maxLength);
  if (f.minLength && f.minLength > 0 && v.length < f.minLength) v = v.padEnd(f.minLength, 'x');
  return v;
}

const PLACEHOLDER_OPTION = /^(\s*|select|choose|none|pick|please.*|--.*|—.*)$/i;

function pickOption(options) {
  if (!options?.length) return null;
  const valid = options.filter((o) => !o.disabled && o.value !== '' && !PLACEHOLDER_OPTION.test(o.text ?? ''));
  const chosen = valid[0] ?? options.find((o) => !o.disabled && o.value !== '') ?? null;
  return chosen ? chosen.value : null;
}

const CONSENT_RE = /\b(agree|terms|accept|consent|privacy|policy|i am over|over 18|confirm|subscribe|opt[- ]?in)\b/;

/**
 * @param {Array} fields - descriptors from perception/forms.js describeForm()
 * @param {() => number} rng - seeded RNG (0..1)
 * @returns {Array<{ index:number, op:'fill'|'select'|'check'|'radio', value:* }>}
 */
export function planFormValues(fields, rng) {
  const plan = [];
  const ctx = { lastEmail: null, lastPassword: null };
  const seenRadioGroups = new Set();

  for (const f of fields ?? []) {
    const type = (f.type || '').toLowerCase();
    const hay = normalizeHay([f.name, f.id, f.label, f.placeholder, f.autocomplete]);

    if (f.tag === 'select') {
      const value = pickOption(f.options);
      if (value != null) plan.push({ index: f.index, op: 'select', value });
      continue;
    }
    if (type === 'checkbox') {
      if (f.required || CONSENT_RE.test(hay)) plan.push({ index: f.index, op: 'check', value: true });
      continue;
    }
    if (type === 'radio') {
      const group = f.radioGroup || f.name || `__r${f.index}`;
      if (!seenRadioGroups.has(group)) {
        seenRadioGroups.add(group);
        plan.push({ index: f.index, op: 'radio', value: true });
      }
      continue;
    }
    if (['file', 'hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;

    const { value, structured } = textValueFor({ type, hay, f, rng, ctx });
    plan.push({ index: f.index, op: 'fill', value: structured ? value : clampText(value, f) });
  }

  return plan;
}

export const _internals = { makeEmail, makePassword, makePhone, numberInRange, pickOption, semanticText };
