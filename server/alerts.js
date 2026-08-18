// Milestone 4: after each ingestion run, check newly-seen jobs (is_new = TRUE)
// against every saved search and queue one alert email per matching search.
// Email delivery goes through the pluggable sender (console stub by default).
import { pool } from './db/pool.js';
import { getEmailSender } from './email/sender.js';
import { buildJobFilters } from './jobFilters.js';

const MAX_LISTED = 10;

export async function processNewJobAlerts() {
  // Snapshot exactly which job ids we're considering right now, and clear
  // is_new only for those ids at the end — not every is_new row that exists
  // by then. Ingestion runs isolate each company in its own try/catch and
  // can overlap with this alert pass; a job inserted mid-pass under the old
  // `WHERE is_new = TRUE` clear would get its is_new flag wiped without ever
  // having been checked against a saved search.
  const [newRows] = await pool.query('SELECT id FROM jobs WHERE is_new = TRUE');
  if (!newRows.length) return { newJobs: 0, alertsSent: 0 };
  const consideredIds = newRows.map((r) => r.id);

  const [searches] = await pool.query(
    'SELECT s.id, s.name, s.filters, u.email FROM saved_searches s JOIN users u ON u.id = s.user_id',
  );

  const sender = getEmailSender();
  let alertsSent = 0;

  for (const s of searches) {
    try {
      const filters = typeof s.filters === 'string' ? JSON.parse(s.filters) : s.filters;
      const { where, params } = buildJobFilters(filters);
      const whereSql = where.length ? `AND ${where.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT title, company, url FROM jobs j
         WHERE j.id IN (?) ${whereSql}
         ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC LIMIT 100`,
        [consideredIds, ...params],
      );
      if (!rows.length) continue;

      const lines = rows.slice(0, MAX_LISTED).map((r) => `- ${r.title} @ ${r.company}\n  ${r.url}`);
      if (rows.length > MAX_LISTED) lines.push(`…and ${rows.length - MAX_LISTED} more on JobBridge`);

      await sender.send({
        to: s.email,
        subject: `JobBridge: ${rows.length} new job${rows.length === 1 ? '' : 's'} for “${s.name}”`,
        text: `New postings matching your saved search “${s.name}”:\n\n${lines.join('\n')}\n`,
      });
      alertsSent++;
    } catch (err) {
      console.error(`[alerts] saved search ${s.id} failed: ${err.message}`);
    }
  }

  // Only the jobs actually considered above have now been checked by every
  // saved search — clear is_new for exactly those ids.
  await pool.query('UPDATE jobs SET is_new = FALSE WHERE id IN (?)', [consideredIds]);
  console.log(`[alerts] ${consideredIds.length} new job(s) checked against ${searches.length} saved search(es), ${alertsSent} alert(s) sent`);
  return { newJobs: consideredIds.length, alertsSent };
}
