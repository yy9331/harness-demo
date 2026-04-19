/**
 * Minimal Anthropic Messages API client (no SDK dependency).
 * @see https://docs.anthropic.com/en/api/messages
 */

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export function getApiKey() {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  if (!k) throw new Error('Missing ANTHROPIC_API_KEY in environment.');
  return k;
}

export function getModel() {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * @param {{ system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; max_tokens?: number }} opts
 */
export async function createMessage({ system, messages, max_tokens = 8192 }) {
  const apiKey = getApiKey();
  const model = getModel();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens,
      system,
      messages,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* keep raw */
    }
    throw new Error(`Anthropic API ${res.status}: ${detail}`);
  }

  const data = JSON.parse(text);
  const blocks = data?.content;
  if (!Array.isArray(blocks)) {
    throw new Error('Unexpected Anthropic response shape (no content array).');
  }
  const textParts = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text);
  return textParts.join('\n').trim();
}
