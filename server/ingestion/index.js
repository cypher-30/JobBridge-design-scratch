import { pool } from '../db/pool.js';
import { processNewJobAlerts } from '../alerts.js';
import { fetchGreenhouse } from './greenhouse.js';
import { fetchLever } from './lever.js';
import { fetchScraped } from './scraper.js';
import { fetchAshby } from './ashby.js';
import { fetchSmartRecruiters } from './smartrecruiters.js';

const FETCHERS = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  scraped: fetchScraped,
  ashby: fetchAshby,
  smartrecruiters: fetchSmartRecruiters,
};

// Guards against overlapping runs. Lives here (not in cron.js) so the manual
// POST /api/ingest/run trigger is covered too — previously only the cron
// tick checked a flag, so a manual trigger could race a scheduled run.
let running = false;

// Runs one full ingestion pass over all active companies.
// Each company is isolated in its own try/catch: a broken API or scraper for
// one company never aborts the run for the others.
export async function runIngestion() {
  if (running) {
    console.log('[ingest] a run is already in progress, skipping');
    return [{ company: '(skipped)', source: 'concurrency-guard', error: 'another ingestion run is already in progress' }];
  }
  running = true;
  try {
    return await runIngestionUnguarded();
  } finally {
    running = false;
  }
}

async function runIngestionUnguarded() {
  const [companies] = await pool.query('SELECT * FROM companies WHERE active = TRUE');
  const summary = [];

  for (const company of companies) {
    const started = Date.now();
    try {
      const cfg = typeof company.config === 'string' ? JSON.parse(company.config) : company.config;
      const jobs = await FETCHERS[company.source_type](company.name, cfg);
      const inserted = await insertJobs(jobs);
      summary.push({ company: company.name, source: company.source_type, fetched: jobs.length, inserted, ms: Date.now() - started });
      console.log(`[ingest] ${company.name} (${company.source_type}): ${jobs.length} fetched, ${inserted} new`);
    } catch (err) {
      summary.push({ company: company.name, source: company.source_type, error: err.message });
      console.error(`[ingest] ${company.name} (${company.source_type}) FAILED: ${err.message}`);
    }
  }

  // Milestone 4: newly-seen jobs are checked against saved searches for alerts.
  try {
    const { newJobs, alertsSent } = await processNewJobAlerts();
    summary.push({ company: '(alerts)', source: 'alerts', fetched: newJobs, inserted: alertsSent });
  } catch (err) {
    console.error(`[alerts] check failed: ${err.message}`);
  }
  return summary;
}

// One multi-row INSERT IGNORE per company instead of one round-trip per job
// — a company with 100+ postings no longer means 100+ sequential queries.
async function insertJobs(jobs) {
  if (!jobs.length) return 0;
  const rows = jobs.map((j) => [
    j.company,
    j.title,
    j.location,
    j.remote,
    j.employment_type,
    j.description,
    j.url,
    j.source,
    j.posted_at,
    j.dedupe_key,
  ]);
  const [result] = await pool.query(
    `INSERT IGNORE INTO jobs
      (company, title, location, remote, employment_type, description, url, source, posted_at, dedupe_key)
     VALUES ?`,
    [rows],
  );
  return result.affectedRows;
}
