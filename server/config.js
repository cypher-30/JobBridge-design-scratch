import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, setGlobalDispatcher } from 'undici';

// This host's DNS synthesizes unroutable IPv6 (DNS64 without NAT64), which
// makes fetch() hang on some APIs. Force IPv4 for all outbound requests.
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

// Load .env from the repo root regardless of cwd. Node 24 built-in, no dotenv.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // no .env yet — rely on real environment variables
}

export const ROOT_DIR = root;

if (!process.env.SESSION_SECRET) {
  // The session secret signs the login cookie — anyone who knows this
  // value can forge a session for any email. Loud warning rather than a
  // hard fail: this app is meant to also run as a quick localhost tool.
  console.warn(
    '[config] SESSION_SECRET is not set — using an insecure default. ' +
      'Anyone who knows it can forge your session cookie. Set SESSION_SECRET in .env before exposing this beyond localhost.',
  );
}

export const config = {
  port: Number(process.env.PORT || 3001),
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'jobbridge',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'jobbridge',
  },
  llm: {
    provider: (process.env.LLM_PROVIDER || 'claude').toLowerCase(),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-4-8',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  ingestIntervalMinutes: Number(process.env.INGEST_INTERVAL_MINUTES || 30),
  outreachReverifyCronUtc: process.env.OUTREACH_REVERIFY_CRON_UTC || '15 1 * * *',
  outreachFollowupAuditCronUtc: process.env.OUTREACH_FOLLOWUP_AUDIT_CRON_UTC || '30 1 * * *',
  githubToken: process.env.GITHUB_TOKEN || '',
};
