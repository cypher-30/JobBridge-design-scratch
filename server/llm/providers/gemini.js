import { GoogleGenAI } from '@google/genai';
import { config } from '../../config.js';

let client;

export async function generateJson({ system, prompt, schema, maxTokens = 16000 }) {
  if (!config.llm.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not set — add it to .env or switch LLM_PROVIDER to claude');
  }
  client ??= new GoogleGenAI({ apiKey: config.llm.geminiApiKey });

  const response = await withRetry(() =>
    client.models.generateContent({
      model: config.llm.geminiModel,
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseSchema: sanitizeSchema(schema),
        maxOutputTokens: maxTokens,
      },
    }),
  );

  const u = response.usageMetadata;
  if (u) console.log(`[llm] gemini tokens: input=${u.promptTokenCount} output=${u.candidatesTokenCount} total=${u.totalTokenCount}`);

  const text = response.text;
  if (!text) throw new Error('Gemini returned no text content');
  return JSON.parse(text);
}

// Gemini returns 429/503 under load (common on free-tier quotas, especially
// for parallel batch analyses). Retry transient errors with backoff.
async function withRetry(fn, attempts = 3) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status ?? err.code;
      const transient = status === 429 || status === 503 || /UNAVAILABLE|RESOURCE_EXHAUSTED/.test(err.message ?? '');
      if (!transient || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i + Math.random() * 500));
    }
  }
}

// Gemini's responseSchema is an OpenAPI-style subset that rejects
// `additionalProperties`; strip it (and $schema) from the shared schemas.
function sanitizeSchema(node) {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'additionalProperties' || k === '$schema') continue;
      out[k] = sanitizeSchema(v);
    }
    return out;
  }
  return node;
}
