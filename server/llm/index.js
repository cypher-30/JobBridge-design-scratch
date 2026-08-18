// Provider-agnostic LLM entry point. Everything outside server/llm/providers/
// calls generateJson() and never touches an SDK directly, so switching between
// Claude and Gemini is a one-line .env change (LLM_PROVIDER=claude|gemini).
import { config } from '../config.js';
import * as claude from './providers/claude.js';
import * as gemini from './providers/gemini.js';

const providers = { claude, gemini };

export function generateJson(args) {
  const provider = providers[config.llm.provider];
  if (!provider) {
    throw new Error(`Unknown LLM_PROVIDER "${config.llm.provider}" — use "claude" or "gemini"`);
  }
  return provider.generateJson(args);
}

export function providerName() {
  return config.llm.provider;
}
