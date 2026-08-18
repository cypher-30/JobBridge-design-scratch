import cron from 'node-cron';
import { config } from './config.js';
import { runIngestion } from './ingestion/index.js';
import { reverifyOutreachForAllUsers } from './outreach/reverify.js';
import { pool } from './db/pool.js';

let reverifyRunning = false;
let followupAuditRunning = false;

// node-cron schedules in the SERVER's local time by default, not UTC. The
// host runs Africa/Nairobi (UTC+3), so OUTREACH_REVERIFY_CRON_UTC='15 1 * * *'
// was actually firing at 01:15 EAT = 22:15 UTC — contradicting both the env
// var's name and the README. { timezone: 'UTC' } makes the schedule mean
// what its name says.
const CRON_OPTS = { timezone: 'UTC' };

export function startIngestionCron() {
  const minutes = Math.max(1, config.ingestIntervalMinutes);
  const expression = `*/${Math.min(minutes, 59)} * * * *`;

  scheduleGuarded(expression, `ingestion every ${minutes} minute(s)`, runIngestion, CRON_OPTS);

  // Also run once shortly after boot so a fresh install has data quickly.
  setTimeout(() => {
    runIngestion().catch((err) => console.error('[cron] boot ingestion failed:', err.message));
  }, 3000);

  scheduleGuarded(
    config.outreachReverifyCronUtc,
    `outreach reverify (UTC): ${config.outreachReverifyCronUtc}`,
    async () => {
      if (reverifyRunning) return console.log('[cron] previous outreach reverify still running, skipping tick');
      reverifyRunning = true;
      try {
        const summary = await reverifyOutreachForAllUsers();
        console.log(
          `[cron] outreach reverify done users=${summary.users_checked} contacts=${summary.updated_contacts}/${summary.total_contacts} verified=${summary.verified} exploratory=${summary.exploratory} failures=${summary.url_check_failures}`,
        );
      } finally {
        reverifyRunning = false;
      }
    },
    CRON_OPTS,
  );

  scheduleGuarded(
    config.outreachFollowupAuditCronUtc,
    `outreach follow-up audit (UTC): ${config.outreachFollowupAuditCronUtc}`,
    async () => {
      if (followupAuditRunning) return console.log('[cron] previous follow-up audit still running, skipping tick');
      followupAuditRunning = true;
      try {
        const [rows] = await pool.query(
          `SELECT user_id, COUNT(*) AS due_count
           FROM outreach_contacts
           WHERE next_follow_up_at IS NOT NULL
             AND next_follow_up_at <= UTC_TIMESTAMP()
             AND response_state IN ('none', 'not_now', 'referred')
           GROUP BY user_id`,
        );
        const totalDue = rows.reduce((sum, r) => sum + Number(r.due_count || 0), 0);
        console.log(`[cron] follow-up audit users_with_due=${rows.length} total_due=${totalDue}`);
      } finally {
        followupAuditRunning = false;
      }
    },
    CRON_OPTS,
  );
}

// cron.schedule throws synchronously on an invalid expression. Previously
// that call happened after app.listen(), so a bad cron string in .env would
// crash the process AFTER it had already bound the port. Catching it here
// keeps a config typo from taking the whole server down.
function scheduleGuarded(expression, label, task, opts) {
  try {
    cron.schedule(
      expression,
      () => {
        task().catch((err) => console.error(`[cron] ${label} failed:`, err.message));
      },
      opts,
    );
    console.log(`[cron] scheduled: ${label}`);
  } catch (err) {
    console.error(`[cron] failed to schedule "${label}" (expression "${expression}"):`, err.message);
  }
}
