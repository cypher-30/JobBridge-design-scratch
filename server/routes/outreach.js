import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from './auth.js';
import { draftOutreachEmail } from '../llm/draftOutreach.js';
import { computeVerification } from '../outreach/verification.js';
import { reverifyOutreachForUser } from '../outreach/reverify.js';
import { computePriority, CONTACT_ROLE_TEMPLATES, SOURCE_PRESETS } from '../outreach/discovery.js';
import { hydrateOutreachContact } from '../outreach/shared.js';

export const outreachRouter = Router();

// Safety cap, not real pagination — at single-user/dozens-of-contacts scale
// this list is meant to be browsed in full (the UI has no pager for it and
// draft text is shown inline), so a hard LIMIT is a cheaper fix than a
// paged UI + on-demand draft fetch for a table that isn't going to reach
// this size.
const MAX_CONTACTS = 1000;

const FIELDS = [
  'company_name',
  'sector',
  'location',
  'careers_url',
  'contact_name',
  'contact_email',
  'source',
  'source_preset',
  'contact_role',
  'notes',
  'tech_stack',
  'why_fit',
  'accepts_attachments',
  'last_contacted_at',
  'next_follow_up_at',
  'follow_up_count',
  'response_state',
];

const EDITABLE_FIELDS = [...FIELDS, 'draft_subject', 'draft_body'];

// GET /api/outreach?status=not_contacted&verification_status=verified|exploratory&verified_age=recent14|recent30|stale30|never&verified_sort=trust|newest|oldest&follow_up=due|upcoming|none&source_preset=&contact_role=
// list this user's outreach contacts.
outreachRouter.get(
  '/',
  requireAuth(async (req, res) => {
    const status = req.query.status;
    const verificationStatus = req.query.verification_status;
    const verifiedAge = String(req.query.verified_age || '').toLowerCase();
    const verifiedSort = String(req.query.verified_sort || 'trust').toLowerCase();
    const followUp = String(req.query.follow_up || '').toLowerCase();
    const sourcePreset = String(req.query.source_preset || '').trim();
    const contactRole = String(req.query.contact_role || '').trim();
    const params = [req.user.id];
    let where = 'WHERE user_id = ?';
    if (status) {
      where += ' AND status = ?';
      params.push(status);
    }
    if (verificationStatus) {
      if (!['verified', 'exploratory'].includes(verificationStatus)) {
        return res.status(400).json({ error: 'verification_status must be verified or exploratory' });
      }
      where += ' AND verification_status = ?';
      params.push(verificationStatus);
    }
    if (sourcePreset) {
      where += ' AND source_preset = ?';
      params.push(sourcePreset);
    }
    if (contactRole) {
      where += ' AND contact_role = ?';
      params.push(contactRole);
    }

    if (verifiedAge) {
      if (!['recent14', 'recent30', 'stale30', 'never'].includes(verifiedAge)) {
        return res.status(400).json({ error: 'verified_age must be recent14, recent30, stale30, or never' });
      }
      if (verifiedAge === 'recent14') where += ' AND last_verified_at IS NOT NULL AND last_verified_at >= (UTC_TIMESTAMP() - INTERVAL 14 DAY)';
      if (verifiedAge === 'recent30') where += ' AND last_verified_at IS NOT NULL AND last_verified_at >= (UTC_TIMESTAMP() - INTERVAL 30 DAY)';
      if (verifiedAge === 'stale30') where += ' AND (last_verified_at IS NULL OR last_verified_at < (UTC_TIMESTAMP() - INTERVAL 30 DAY))';
      if (verifiedAge === 'never') where += ' AND last_verified_at IS NULL';
    }

    if (followUp) {
      if (!['due', 'upcoming', 'none'].includes(followUp)) {
        return res.status(400).json({ error: 'follow_up must be due, upcoming, or none' });
      }
      if (followUp === 'due') where += ' AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= UTC_TIMESTAMP()';
      if (followUp === 'upcoming') where += ' AND next_follow_up_at IS NOT NULL AND next_follow_up_at > UTC_TIMESTAMP()';
      if (followUp === 'none') where += ' AND next_follow_up_at IS NULL';
    }

    if (!['trust', 'newest', 'oldest'].includes(verifiedSort)) {
      return res.status(400).json({ error: 'verified_sort must be trust, newest, or oldest' });
    }

    const sortSql =
      verifiedSort === 'newest'
        ? "verification_status = 'verified' DESC, last_verified_at IS NULL, last_verified_at DESC, priority_score DESC, trust_score DESC, status = 'not_contacted' DESC, updated_at DESC"
        : verifiedSort === 'oldest'
          ? "verification_status = 'verified' DESC, last_verified_at IS NULL, last_verified_at ASC, priority_score DESC, trust_score DESC, status = 'not_contacted' DESC, updated_at DESC"
          : "verification_status = 'verified' DESC, priority_score DESC, trust_score DESC, last_verified_at IS NULL, last_verified_at DESC, status = 'not_contacted' DESC, updated_at DESC";

    // No lazy re-score here on purpose: this used to recompute verification
    // for every row on every page load and write back any that changed —
    // which was *every* row with a pre-migration NULL verification_reasons,
    // i.e. an UPDATE storm on every GET. Scoring is now refreshed only by
    // POST /api/outreach/reverify (the "Re-verify all links" button) and the
    // nightly cron; reads are read-only.
    const [rows] = await pool.query(
      `SELECT * FROM outreach_contacts ${where}
       ORDER BY ${sortSql}
       LIMIT ${MAX_CONTACTS}`,
      params,
    );

    res.json({ contacts: rows.map(hydrateOutreachContact) });
  }),
);

outreachRouter.get(
  '/meta',
  requireAuth(async (_req, res) => {
    res.json({ source_presets: SOURCE_PRESETS, contact_role_templates: CONTACT_ROLE_TEMPLATES });
  }),
);

// POST /api/outreach/reverify — live-check careers URLs for all contacts and
// refresh verification_status/trust_score/reasons/freshness fields in one run.
outreachRouter.post(
  '/reverify',
  requireAuth(async (req, res) => {
    // reverifyOutreachForUser already no-ops cleanly on zero rows — no need
    // to SELECT here first just to check emptiness before it re-queries.
    const summary = await reverifyOutreachForUser(req.user.id);
    res.json({ summary });
  }),
);

// POST /api/outreach — add a contact (manual entry, e.g. from research).
outreachRouter.post(
  '/',
  requireAuth(async (req, res) => {
    const body = req.body ?? {};
    if (!body.company_name) return res.status(400).json({ error: 'company_name is required' });
    const payload = Object.fromEntries(FIELDS.map((f) => [f, toColumnValue(f, body[f])]));
    payload.is_example = Boolean(body.is_example);
    const verification = computeVerification(payload);
    const priority = computePriority({ ...payload, ...verification });

    const [result] = await pool.query(
      `INSERT INTO outreach_contacts
         (user_id, ${FIELDS.join(', ')}, is_example, verification_status, trust_score, verification_reasons, priority_score, priority_reasons)
       VALUES (?, ${FIELDS.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        ...FIELDS.map((f) => payload[f]),
        payload.is_example,
        verification.verification_status,
        verification.trust_score,
        JSON.stringify(verification.verification_reasons),
        priority.priority_score,
        JSON.stringify(priority.priority_reasons),
      ],
    );
    const [[row]] = await pool.query('SELECT * FROM outreach_contacts WHERE id = ?', [result.insertId]);
    res.json({ contact: hydrateOutreachContact(row) });
  }),
);

// Fields that, if edited, plausibly change the verification evidence
// (careers URL, source/notes text, location, etc.) — only these clear a
// stale last_verification_error. Editing draft_body, for instance,
// shouldn't discard live-check evidence for an unrelated field.
const VERIFICATION_RELEVANT_FIELDS = new Set([
  'careers_url',
  'source',
  'notes',
  'location',
  'contact_email',
  'accepts_attachments',
  'source_preset',
]);

// PUT /api/outreach/:id — edit contact fields.
outreachRouter.put(
  '/:id',
  requireAuth(async (req, res) => {
    const contact = await ownedContact(req);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const body = req.body ?? {};
    const updates = EDITABLE_FIELDS.filter((f) => f in body);
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    const merged = hydrateOutreachContact({ ...contact, ...Object.fromEntries(updates.map((f) => [f, toColumnValue(f, body[f])])) });
    const touchesVerification = updates.some((f) => VERIFICATION_RELEVANT_FIELDS.has(f));
    const verification = computeVerification(
      touchesVerification ? { ...merged, last_verification_error: null } : merged,
    );
    const priority = computePriority({ ...merged, ...verification });

    const setFields = [...updates, 'verification_status', 'trust_score', 'verification_reasons', 'priority_score', 'priority_reasons'];
    const setValues = [
      ...updates.map((f) => toColumnValue(f, body[f])),
      verification.verification_status,
      verification.trust_score,
      JSON.stringify(verification.verification_reasons),
      priority.priority_score,
      JSON.stringify(priority.priority_reasons),
    ];
    if (touchesVerification) {
      setFields.push('last_verification_error');
      setValues.push(null);
    }

    await pool.query(
      `UPDATE outreach_contacts SET ${setFields.map((f) => `${f} = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
      [...setValues, contact.id, req.user.id],
    );

    const [[row]] = await pool.query('SELECT * FROM outreach_contacts WHERE id = ?', [contact.id]);
    res.json({ contact: hydrateOutreachContact(row) });
  }),
);

// POST /api/outreach/:id/draft — generate/regenerate the email draft.
// This ONLY writes subject/body/status to the DB — no email is ever sent.
outreachRouter.post(
  '/:id/draft',
  requireAuth(async (req, res) => {
    const contact = await ownedContact(req);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const [[cv]] = await pool.query(
      'SELECT id, parsed FROM cvs WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [req.user.id],
    );
    if (!cv) return res.status(409).json({ error: 'Upload a CV first' });
    const parsedCv = typeof cv.parsed === 'string' ? JSON.parse(cv.parsed) : cv.parsed;

    const [[qualityRow]] = await pool.query(
      'SELECT key_strengths FROM cv_quality_scores WHERE cv_id = ? ORDER BY id DESC LIMIT 1',
      [cv.id],
    );
    const qualityScore = qualityRow
      ? { key_strengths: typeof qualityRow.key_strengths === 'string' ? JSON.parse(qualityRow.key_strengths) : qualityRow.key_strengths }
      : null;

    const draft = await draftOutreachEmail(parsedCv, contact, qualityScore);

    await pool.query(
      `UPDATE outreach_contacts
       SET draft_subject = ?, draft_body = ?, draft_generated_at = CURRENT_TIMESTAMP, status = 'drafted'
       WHERE id = ? AND user_id = ?`,
      [draft.subject, draft.body, contact.id, req.user.id],
    );
    const [[row]] = await pool.query('SELECT * FROM outreach_contacts WHERE id = ?', [contact.id]);
    res.json({ contact: hydrateOutreachContact(row) });
  }),
);

// PATCH /api/outreach/:id/status — mark sent/replied after you actually send it yourself.
outreachRouter.patch(
  '/:id/status',
  requireAuth(async (req, res) => {
    const status = req.body?.status;
    if (!['not_contacted', 'drafted', 'sent', 'replied'].includes(status)) {
      return res.status(400).json({ error: 'status must be one of not_contacted, drafted, sent, replied' });
    }
    const contact = await ownedContact(req);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    await pool.query('UPDATE outreach_contacts SET status = ? WHERE id = ? AND user_id = ?', [
      status,
      contact.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  }),
);

outreachRouter.post(
  '/:id/followup',
  requireAuth(async (req, res) => {
    const contact = await ownedContact(req);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });

    const days = Math.max(1, Math.min(60, Number(req.body?.next_in_days) || 7));
    const noteContacted = req.body?.mark_contacted !== false;

    await pool.query(
      `UPDATE outreach_contacts
       SET follow_up_count = follow_up_count + 1,
           next_follow_up_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY),
           last_contacted_at = CASE WHEN ? THEN UTC_TIMESTAMP() ELSE last_contacted_at END,
           status = CASE WHEN status = 'not_contacted' THEN 'sent' ELSE status END
       WHERE id = ? AND user_id = ?`,
      [days, noteContacted, contact.id, req.user.id],
    );

    const [[row]] = await pool.query('SELECT * FROM outreach_contacts WHERE id = ?', [contact.id]);
    const hydrated = hydrateOutreachContact(row);
    const priority = computePriority(hydrated);
    await pool.query(
      'UPDATE outreach_contacts SET priority_score = ?, priority_reasons = ? WHERE id = ? AND user_id = ?',
      [priority.priority_score, JSON.stringify(priority.priority_reasons), contact.id, req.user.id],
    );
    const [[updated]] = await pool.query('SELECT * FROM outreach_contacts WHERE id = ?', [contact.id]);
    res.json({ contact: hydrateOutreachContact(updated) });
  }),
);

outreachRouter.delete(
  '/:id',
  requireAuth(async (req, res) => {
    await pool.query('DELETE FROM outreach_contacts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  }),
);

async function ownedContact(req) {
  const [[row]] = await pool.query('SELECT * FROM outreach_contacts WHERE id = ? AND user_id = ?', [
    req.params.id,
    req.user.id,
  ]);
  return row ?? null;
}

// Matches the VARCHAR/TEXT column widths in schema.sql. Without this, an
// over-length value throws ER_DATA_TOO_LONG deep in the driver, surfacing
// as an opaque 500 instead of a 400 telling the caller what's wrong.
const COLUMN_MAX_LENGTHS = {
  company_name: 255,
  sector: 255,
  location: 255,
  careers_url: 1024,
  contact_name: 255,
  contact_email: 320,
  source: 255,
  source_preset: 100,
  contact_role: 100,
  draft_subject: 500,
};

function toColumnValue(field, value) {
  if (field === 'tech_stack') return JSON.stringify(Array.isArray(value) ? value : []);
  if (field === 'accepts_attachments') return ['true', 'false', 'unknown'].includes(value) ? value : 'unknown';
  if (field === 'follow_up_count') return Math.max(0, Number(value) || 0);
  if (field === 'last_contacted_at' || field === 'next_follow_up_at') {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (field === 'response_state') {
    return ['none', 'interested', 'not_now', 'rejected', 'referred'].includes(value) ? value : 'none';
  }
  const maxLength = COLUMN_MAX_LENGTHS[field];
  if (maxLength && typeof value === 'string') return value.slice(0, maxLength);
  return value ?? null;
}
