// DOM side of FORM_FILL. Everything runs inside page.raw.evaluate so it is engine-
// agnostic (Playwright + Puppeteer) and framework-agnostic: values are written with
// the native value setter + bubbled input/change events, which is what React (and
// Vue/Svelte) controlled inputs actually listen to — plain el.value = x does not
// update their state.
//
// Three calls, all keyed off a fillable-form index that is stable within a step:
//   detectFillableForms(page) — cheap; lists fillable forms for per-step gating.
//   describeForm(page, index) — tags fields (data-mfill) / submit (data-msubmit),
//                               returns descriptors for the seeded planner.
//   applyFormValues(page, plan) — writes the planned values and submits.
//
// A "form" is a real <form>; if the page has none, the document body is treated as a
// single synthetic form (best-effort for apps that wire inputs without a <form>).
// detect and describe MUST compute the same ordered list of fillable containers so the
// index lines up between the two calls.

export async function detectFillableForms(rawPage) {
  if (!rawPage || rawPage._isLightpanda) return [];
  try {
    return await rawPage.evaluate(() => {
      const isVisible = (el) => {
        if (!el || el.disabled) return false;
        if (!el.getClientRects().length) return false;
        const st = getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none';
      };
      const isFillable = (el) => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'textarea' || tag === 'select') return isVisible(el);
        if (tag !== 'input') return false;
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        if (['hidden', 'submit', 'button', 'image', 'reset'].includes(t)) return false;
        return isVisible(el);
      };
      const SUBMIT_RE = /\b(submit|save|create|sign\s?up|sign\s?in|log\s?in|register|continue|add|send|post|update|next|done|apply|search|subscribe|join|confirm|checkout|pay|order|book)\b/i;
      const findSubmit = (root) => {
        const s = root.querySelector('button[type=submit], input[type=submit]');
        if (s) return s;
        const btns = Array.from(root.querySelectorAll('button, [role=button], input[type=button]'));
        return btns.find((b) => SUBMIT_RE.test((b.textContent || b.value || '').trim())) || null;
      };
      const realForms = Array.from(document.forms).filter(isVisible);
      const containers = (realForms.length ? realForms : [document.body])
        .map((c) => ({ c, fields: Array.from(c.querySelectorAll('input, textarea, select')).filter(isFillable) }))
        .filter((x) => x.fields.length > 0);
      return containers.map((x, i) => ({ index: i, fieldCount: x.fields.length, hasSubmit: !!findSubmit(x.c) }));
    });
  } catch {
    return [];
  }
}

export async function describeForm(rawPage, index = 0) {
  if (!rawPage || rawPage._isLightpanda) return { fields: [], hasSubmit: false };
  return rawPage.evaluate((idx) => {
    const isVisible = (el) => {
      if (!el || el.disabled) return false;
      if (!el.getClientRects().length) return false;
      const st = getComputedStyle(el);
      return st.visibility !== 'hidden' && st.display !== 'none';
    };
    const isFillable = (el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'select') return isVisible(el);
      if (tag !== 'input') return false;
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(t)) return false;
      return isVisible(el);
    };
    const SUBMIT_RE = /\b(submit|save|create|sign\s?up|sign\s?in|log\s?in|register|continue|add|send|post|update|next|done|apply|search|subscribe|join|confirm|checkout|pay|order|book)\b/i;
    const findSubmit = (root) => {
      const s = root.querySelector('button[type=submit], input[type=submit]');
      if (s) return s;
      const btns = Array.from(root.querySelectorAll('button, [role=button], input[type=button]'));
      return btns.find((b) => SUBMIT_RE.test((b.textContent || b.value || '').trim())) || null;
    };
    const realForms = Array.from(document.forms).filter(isVisible);
    const containers = (realForms.length ? realForms : [document.body])
      .map((c) => ({ c, fields: Array.from(c.querySelectorAll('input, textarea, select')).filter(isFillable) }))
      .filter((x) => x.fields.length > 0);
    const form = containers[idx] || containers[0];
    if (!form) return { fields: [], hasSubmit: false };

    const labelFor = (el) => {
      let t = '';
      if (el.id) {
        const safe = window.CSS && CSS.escape ? CSS.escape(el.id) : el.id;
        const l = document.querySelector('label[for="' + safe + '"]');
        if (l) t = l.textContent || '';
      }
      if (!t) { const l = el.closest('label'); if (l) t = l.textContent || ''; }
      if (!t) t = el.getAttribute('aria-label') || '';
      return t.replace(/\s+/g, ' ').trim().slice(0, 80);
    };

    const fields = form.fields.map((el, i) => {
      el.setAttribute('data-mfill', String(i));
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || (tag === 'input' ? 'text' : '')).toLowerCase();
      const d = {
        index: i, tag, type,
        name: el.name || '', id: el.id || '',
        label: labelFor(el),
        placeholder: el.getAttribute('placeholder') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        required: !!el.required,
        maxLength: el.maxLength > 0 ? el.maxLength : null,
        minLength: el.minLength > 0 ? el.minLength : null,
        min: el.getAttribute('min'), max: el.getAttribute('max'), step: el.getAttribute('step'),
        pattern: el.getAttribute('pattern'),
        inputmode: el.getAttribute('inputmode') || '',
        radioGroup: type === 'radio' ? (el.name || '') : '',
      };
      if (tag === 'select') {
        d.options = Array.from(el.options).map((o) => ({ value: o.value, text: (o.textContent || '').trim(), disabled: o.disabled }));
      }
      return d;
    });

    const submit = findSubmit(form.c);
    if (submit) submit.setAttribute('data-msubmit', '1');
    return { fields, hasSubmit: !!submit };
  }, index);
}

export async function applyFormValues(rawPage, plan) {
  if (!rawPage || rawPage._isLightpanda || !plan?.length) return { filled: 0, submitted: false };
  return rawPage.evaluate((items) => {
    const setNativeValue = (el, value) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    let filled = 0;
    for (const it of items) {
      const el = document.querySelector('[data-mfill="' + it.index + '"]');
      if (!el) continue;
      try {
        if (it.op === 'fill') {
          el.focus();
          setNativeValue(el, String(it.value));
          el.blur();
          filled++;
        } else if (it.op === 'select') {
          const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
          if (desc && desc.set) desc.set.call(el, String(it.value));
          else el.value = String(it.value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
        } else if (it.op === 'check' || it.op === 'radio') {
          if (!el.checked) el.click();
          filled++;
        }
      } catch { /* one bad field must not abort the rest */ }
    }

    let submitted = false;
    const submit = document.querySelector('[data-msubmit="1"]');
    if (submit) {
      try { submit.click(); submitted = true; } catch { /* ignore */ }
    } else {
      const anchor = document.querySelector('[data-mfill]');
      const form = anchor && anchor.form;
      if (form && form.requestSubmit) {
        try { form.requestSubmit(); submitted = true; } catch { /* ignore */ }
      }
    }
    return { filled, submitted };
  }, plan);
}
