import { describeForm, applyFormValues } from '../perception/forms.js';
import { planFormValues } from './formPlan.js';

// FORM_FILL action: fill every field of one form with seeded valid data and submit it.
// This is what turns a random crawl into one that actually produces backend writes —
// the prerequisite for the cross-layer (STATE_*) and authz oracles to have anything
// to inspect.
export async function runFormFill({ page, target, rng, sentinel = null }) {
  const start = Date.now();
  const index = target?.formIndex ?? 0;
  try {
    const { fields } = await describeForm(page.raw, index);
    if (!fields?.length) {
      return { success: false, error: 'no fillable fields', latencyMs: Date.now() - start };
    }
    const plan = planFormValues(fields, rng, sentinel);
    const { filled, submitted } = await applyFormValues(page.raw, plan);
    return {
      success: filled > 0,
      filled,
      submitted,
      fields: fields.length,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return { success: false, error: err.message, latencyMs: Date.now() - start };
  }
}
