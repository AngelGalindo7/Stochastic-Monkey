import OpenAI from 'openai';

let client = null;
let warned = false;

function getClient() {
  if (client) return client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  client = new OpenAI({ apiKey: key });
  return client;
}

export function llmAvailable() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function warnOnce(reason) {
  if (warned) return;
  warned = true;
  console.warn(`[llm] disabled: ${reason}. Falling back to deterministic stubs.`);
}

export async function complete({ prompt, model = 'gpt-4o-mini', maxTokens = 200, temperature = 0.4 }) {
  const c = getClient();
  if (!c) {
    warnOnce('OPENAI_API_KEY missing');
    return stubResponse(prompt);
  }
  try {
    const res = await c.chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.choices?.[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    warnOnce(`OpenAI call failed: ${err.message}`);
    return stubResponse(prompt);
  }
}

export function stubResponse(prompt) {
  if (prompt.includes('Reply with JSON')) {
    return '{"score": 0.0, "reason": "stub: LLM unavailable, hard signals only"}';
  }
  return 'The action will probably navigate or change the visible content.';
}
