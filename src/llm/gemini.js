let warned = false;

function warnOnce(reason) {
  if (warned) return;
  warned = true;
  console.warn(`[llm] disabled: ${reason}. Falling back to deterministic stubs.`);
}

export function llmAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function complete({ prompt, model = 'gemini-2.5-flash-lite', maxTokens = 200, temperature = 0.4 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    warnOnce('GEMINI_API_KEY missing');
    return stubResponse(prompt);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    return text || stubResponse(prompt);
  } catch (err) {
    warnOnce(`Gemini call failed: ${err.message}`);
    return stubResponse(prompt);
  }
}

export function stubResponse(prompt) {
  if (prompt.includes('Reply with JSON')) {
    return '{"score": 0.0, "reason": "stub: LLM unavailable, hard signals only"}';
  }
  return 'The action will probably navigate or change the visible content.';
}
