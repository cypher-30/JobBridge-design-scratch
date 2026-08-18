import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config.js';

let client;

// Structured outputs (output_config.format) guarantee schema-valid JSON.
// No temperature / no prefills — both are rejected on claude-opus-4-8.
export async function generateJson({ system, prompt, schema, maxTokens = 16000 }) {
  if (!config.llm.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — add it to .env or switch LLM_PROVIDER to gemini');
  }
  client ??= new Anthropic({ apiKey: config.llm.anthropicApiKey });

  const response = await client.messages.create({
    model: config.llm.claudeModel,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: { type: 'json_schema', schema } },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to process this content.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Model output was truncated (max_tokens reached).');
  }

  console.log(`[llm] claude tokens: input=${response.usage.input_tokens} output=${response.usage.output_tokens}`);

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Claude returned no text content');
  return JSON.parse(text);
}
