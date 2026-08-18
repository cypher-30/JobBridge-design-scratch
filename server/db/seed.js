// Sync config/companies.json into the companies table.
// New companies are inserted; existing ones (same name + source_type) get their config updated.
import fs from 'node:fs';
import path from 'node:path';
import { pool } from './pool.js';
import { ROOT_DIR } from '../config.js';
import { reverifyOutreachForUser } from '../outreach/reverify.js';

const file = path.join(ROOT_DIR, 'config', 'companies.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const rows = [];
for (const c of data.greenhouse ?? []) {
  rows.push([c.company_name, 'greenhouse', JSON.stringify({ token: c.token })]);
}
for (const c of data.lever ?? []) {
  rows.push([c.company_name, 'lever', JSON.stringify({ site: c.site })]);
}
for (const c of data.scraped ?? []) {
  if (c.company_name.startsWith('EXAMPLE')) continue; // placeholder entry, not a real target
  rows.push([
    c.company_name,
    'scraped',
    JSON.stringify({ careers_url: c.careers_url, selectors: c.selectors ?? null }),
  ]);
}
for (const c of data.ashby ?? []) {
  rows.push([c.company_name, 'ashby', JSON.stringify({ hosted_jobs_page: c.hosted_jobs_page })]);
}
for (const c of data.smartrecruiters ?? []) {
  rows.push([c.company_name, 'smartrecruiters', JSON.stringify({ company_identifier: c.company_identifier })]);
}

for (const [name, sourceType, cfg] of rows) {
  await pool.query(
    `INSERT INTO companies (name, source_type, config) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE config = VALUES(config)`,
    [name, sourceType, cfg],
  );
}

console.log(`Seeded ${rows.length} companies from config/companies.json`);

// Outreach contacts (direct HR-contact pool) are per-user, so seeding needs a
// target user. Set SEED_USER_EMAIL in .env to the account you'll actually use
// JobBridge as; without it, seeding is skipped (nothing to attach rows to yet).
const outreachFile = path.join(ROOT_DIR, 'config', 'outreach_contacts.json');
if (fs.existsSync(outreachFile) && process.env.SEED_USER_EMAIL) {
  const email = process.env.SEED_USER_EMAIL.trim().toLowerCase();
  await pool.query('INSERT IGNORE INTO users (email) VALUES (?)', [email]);
  const [[user]] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);

  const outreachData = JSON.parse(fs.readFileSync(outreachFile, 'utf8'));
  let seeded = 0;
  for (const c of outreachData.contacts ?? []) {
    const [existing] = await pool.query(
      'SELECT id FROM outreach_contacts WHERE user_id = ? AND company_name = ?',
      [user.id, c.company_name],
    );
    if (existing.length) continue; // don't clobber a company the user is already tracking/editing
    // No verification_status/trust_score computed here — under the
    // evidence-tier model (server/outreach/verification.js) a score without
    // a live check can only ever be Tier D/E, and computing one at seed
    // time risks looking like an authoritative result that was never
    // actually live-checked. Rows land at the schema defaults
    // (exploratory / trust_score 0) and get their real score from the
    // reverifyOutreachForUser() call below, same as any other contact.
    await pool.query(
      `INSERT INTO outreach_contacts
         (user_id, company_name, sector, location, careers_url, contact_name, contact_email, source, source_preset, contact_role, notes, tech_stack, why_fit, accepts_attachments, is_example)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        c.company_name,
        c.sector ?? null,
        c.location ?? null,
        c.careers_url ?? null,
        c.contact_name ?? null,
        c.contact_email ?? null,
        c.source ?? null,
        c.source_preset ?? null,
        c.contact_role ?? null,
        c.notes ?? null,
        JSON.stringify(c.tech_stack ?? []),
        c.why_fit ?? null,
        c.accepts_attachments ?? 'unknown',
        Boolean(c.is_example),
      ],
    );
    seeded++;
  }
  console.log(`Seeded ${seeded} outreach contact(s) from config/outreach_contacts.json for ${email}`);

  if (seeded > 0) {
    console.log('Live-checking careers URLs to score the newly seeded contacts (same as "Re-verify all links")...');
    const summary = await reverifyOutreachForUser(user.id);
    console.log(
      `Verification: ${summary.verified} verified, ${summary.exploratory} exploratory, ${summary.url_check_failures} URL check failure(s).`,
    );
  }
} else if (fs.existsSync(outreachFile)) {
  console.log('config/outreach_contacts.json found but SEED_USER_EMAIL is not set in .env — skipping outreach seed.');
}

await pool.end();
