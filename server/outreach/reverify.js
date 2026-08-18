import { pool } from '../db/pool.js';
import { computeVerificationWithReliability, liveCheckUrl } from './verification.js';
import { computePriority } from './discovery.js';
import { hydrateOutreachContact, mapWithConcurrency } from './shared.js';

// Live-checking every contact fully sequentially (up to two 7s-timeout
// fetches each) made a run of 100+ contacts take tens of minutes, awaited
// inline by the HTTP handler — the request would time out well before the
// work finished. Bounded concurrency keeps it fast without hammering any
// one ATS host.
const CONCURRENCY = 6;

export async function reverifyOutreachForUser(userId) {
  const [rows] = await pool.query('SELECT * FROM outreach_contacts WHERE user_id = ?', [userId]);
  const contacts = rows.map(hydrateOutreachContact);
  if (!contacts.length) {
    return { total: 0, updated: 0, verified: 0, exploratory: 0, url_check_failures: 0, failures: [] };
  }

  // Contacts that share the exact same careers_url (e.g. two contacts at
  // the same company) only need the live fetch performed once per run.
  const checkCache = new Map();
  function checkFor(url) {
    if (!checkCache.has(url)) checkCache.set(url, liveCheckUrl(url));
    return checkCache.get(url);
  }

  let verified = 0;
  let exploratory = 0;
  let url_check_failures = 0;
  const failures = [];

  const results = await mapWithConcurrency(contacts, CONCURRENCY, async (contact) => {
    const url = String(contact.careers_url ?? '').trim();
    const precomputedCheck = url ? await checkFor(url) : undefined;
    const verification = await computeVerificationWithReliability(contact, { precomputedCheck });
    const priority = computePriority({ ...contact, ...verification });
    return { id: contact.id, company_name: contact.company_name, verification, priority };
  });

  for (const { id, company_name, verification, priority } of results) {
    if (verification.verification_status === 'verified') verified += 1;
    else exploratory += 1;
    if (verification.last_verification_error) {
      url_check_failures += 1;
      failures.push({ company_name, error: verification.last_verification_error });
    }

    await pool.query(
      `UPDATE outreach_contacts
       SET verification_status = ?, trust_score = ?, verification_reasons = ?,
           last_verified_at = ?, last_verification_error = ?,
           priority_score = ?, priority_reasons = ?
       WHERE id = ? AND user_id = ?`,
      [
        verification.verification_status,
        verification.trust_score,
        JSON.stringify(verification.verification_reasons),
        verification.last_verified_at,
        verification.last_verification_error,
        priority.priority_score,
        JSON.stringify(priority.priority_reasons),
        id,
        userId,
      ],
    );
  }

  return { total: contacts.length, updated: results.length, verified, exploratory, url_check_failures, failures };
}

export async function reverifyOutreachForAllUsers() {
  const [users] = await pool.query('SELECT DISTINCT user_id FROM outreach_contacts');
  let users_checked = 0;
  let total_contacts = 0;
  let updated_contacts = 0;
  let verified = 0;
  let exploratory = 0;
  let url_check_failures = 0;

  for (const row of users) {
    const userId = Number(row.user_id);
    if (!Number.isFinite(userId)) continue;
    const summary = await reverifyOutreachForUser(userId);
    users_checked += 1;
    total_contacts += summary.total;
    updated_contacts += summary.updated;
    verified += summary.verified;
    exploratory += summary.exploratory;
    url_check_failures += summary.url_check_failures;
  }

  return {
    users_checked,
    total_contacts,
    updated_contacts,
    verified,
    exploratory,
    url_check_failures,
  };
}
