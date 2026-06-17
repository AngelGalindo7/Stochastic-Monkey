import { describe, it, expect } from 'vitest';
import seedrandom from 'seedrandom';
import { planFormValues } from '../../src/actions/formPlan.js';

// Minimal field-descriptor factory (mirrors perception/forms.js describeForm output).
function field(overrides = {}) {
  return {
    index: 0, tag: 'input', type: 'text', name: '', id: '', label: '', placeholder: '',
    autocomplete: '', required: false, maxLength: null, minLength: null,
    min: null, max: null, step: null, pattern: null, inputmode: '', radioGroup: '',
    ...overrides,
  };
}

const rng = () => seedrandom('seed-1')();
function freshPlan(fields) {
  return planFormValues(fields, seedrandom('seed-1'));
}

describe('planFormValues — typed text', () => {
  it('generates a valid email for type=email', () => {
    const [item] = freshPlan([field({ type: 'email' })]);
    expect(item.op).toBe('fill');
    expect(item.value).toMatch(/^monkey\d+@example\.com$/);
  });

  it('generates a policy-compliant password for type=password', () => {
    const [item] = freshPlan([field({ type: 'password' })]);
    const v = item.value;
    expect(v.length).toBeGreaterThanOrEqual(8);
    expect(v).toMatch(/[A-Z]/);
    expect(v).toMatch(/[a-z]/);
    expect(v).toMatch(/\d/);
    expect(v).toMatch(/[^A-Za-z0-9]/);
  });

  it('infers email/password from the field name even when type=text', () => {
    const plan = freshPlan([
      field({ index: 0, name: 'userEmail' }),
      field({ index: 1, name: 'pwd' }),
    ]);
    expect(plan[0].value).toMatch(/@example\.com$/);
    expect(plan[1].value).toMatch(/[A-Z].*\d/);
  });

  it('matches a confirm-password to the original password', () => {
    const plan = freshPlan([
      field({ index: 0, type: 'password', name: 'password' }),
      field({ index: 1, type: 'password', name: 'confirmPassword', label: 'Confirm password' }),
    ]);
    expect(plan[0].value).toBe(plan[1].value);
  });

  it('matches a confirm-email to the original email', () => {
    const plan = freshPlan([
      field({ index: 0, type: 'email', name: 'email' }),
      field({ index: 1, type: 'email', name: 'email_confirmation', label: 'Re-enter email' }),
    ]);
    expect(plan[0].value).toBe(plan[1].value);
  });

  it('generates a phone for type=tel and a url for type=url', () => {
    const [tel] = freshPlan([field({ type: 'tel' })]);
    expect(tel.value).toMatch(/^\+1555\d{7}$/);
    const [url] = freshPlan([field({ type: 'url' })]);
    expect(url.value).toMatch(/^https?:\/\//);
  });

  it('maps common field names to plausible values', () => {
    const plan = freshPlan([
      field({ index: 0, name: 'firstName' }),
      field({ index: 1, name: 'last_name' }),
      field({ index: 2, name: 'city' }),
      field({ index: 3, name: 'zip' }),
    ]);
    expect(plan[0].value).toBe('Test');
    expect(plan[1].value).toBe('User');
    expect(plan[2].value).toBe('Springfield');
    expect(plan[3].value).toBe('94016');
  });
});

describe('planFormValues — numbers and dates', () => {
  it('respects min/max/step on a number field', () => {
    const [item] = freshPlan([field({ type: 'number', min: '5', max: '9', step: '1' })]);
    const n = Number(item.value);
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(9);
  });

  it('produces a date within a min bound', () => {
    const [item] = freshPlan([field({ type: 'date', min: '2025-01-01' })]);
    expect(item.value >= '2025-01-01').toBe(true);
  });
});

describe('planFormValues — selects, checkboxes, radios', () => {
  it('selects the first real option, skipping a placeholder', () => {
    const [item] = freshPlan([field({
      tag: 'select', type: '',
      options: [
        { value: '', text: 'Select one', disabled: false },
        { value: 'us', text: 'United States', disabled: false },
        { value: 'ca', text: 'Canada', disabled: false },
      ],
    })]);
    expect(item.op).toBe('select');
    expect(item.value).toBe('us');
  });

  it('checks a required checkbox and a consent checkbox, skips an optional one', () => {
    const plan = freshPlan([
      field({ index: 0, type: 'checkbox', required: true, name: 'tos' }),
      field({ index: 1, type: 'checkbox', label: 'I agree to the terms' }),
      field({ index: 2, type: 'checkbox', name: 'newsletterMaybe', label: 'send me filters' }),
    ]);
    const checked = plan.filter((p) => p.op === 'check').map((p) => p.index);
    expect(checked).toContain(0);
    expect(checked).toContain(1);
    expect(checked).not.toContain(2);
  });

  it('selects exactly one radio per group', () => {
    const plan = freshPlan([
      field({ index: 0, type: 'radio', name: 'plan', radioGroup: 'plan' }),
      field({ index: 1, type: 'radio', name: 'plan', radioGroup: 'plan' }),
      field({ index: 2, type: 'radio', name: 'size', radioGroup: 'size' }),
    ]);
    const radios = plan.filter((p) => p.op === 'radio').map((p) => p.index);
    expect(radios).toEqual([0, 2]);
  });
});

describe('planFormValues — constraints and skips', () => {
  it('clamps generic text to maxLength and pads to minLength', () => {
    const [long] = freshPlan([field({ name: 'bio', maxLength: 4 })]);
    expect(long.value.length).toBeLessThanOrEqual(4);
    const [short] = freshPlan([field({ name: 'nickname-ish', label: 'tag', minLength: 6, type: 'text' })]);
    expect(short.value.length).toBeGreaterThanOrEqual(6);
  });

  it('does not clamp a structured value (email) that exceeds maxLength', () => {
    const [item] = freshPlan([field({ type: 'email', maxLength: 5 })]);
    expect(item.value).toMatch(/@example\.com$/); // not truncated to 5
  });

  it('skips hidden, submit, file and button inputs', () => {
    const plan = freshPlan([
      field({ index: 0, type: 'hidden' }),
      field({ index: 1, type: 'submit' }),
      field({ index: 2, type: 'file' }),
      field({ index: 3, type: 'button' }),
    ]);
    expect(plan).toHaveLength(0);
  });
});

describe('planFormValues — determinism', () => {
  it('is identical across two fresh runs with the same seed', () => {
    const fields = [
      field({ index: 0, type: 'email', name: 'email' }),
      field({ index: 1, type: 'password', name: 'password' }),
      field({ index: 2, name: 'displayName' }),
    ];
    const a = planFormValues(fields, seedrandom('42'));
    const b = planFormValues(fields, seedrandom('42'));
    expect(a).toEqual(b);
  });
});
