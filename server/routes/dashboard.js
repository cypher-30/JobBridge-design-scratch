import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from './auth.js';

export const dashboardRouter = Router();

// GET /api/dashboard/summary?window_days=7
// Small aggregate payload for a home/dashboard card set.
dashboardRouter.get(
  '/summary',
  requireAuth(async (req, res) => {
    const windowDays = clampInt(req.query.window_days, 7, 1, 30);

    const [[latestCv]] = await pool.query(
      'SELECT id FROM cvs WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [req.user.id],
    );
    const latestCvId = latestCv?.id ?? null;

    const [
      [[newMatchesRow]],
      [[followUpsDueRow]],
      [[outreachSummaryRow]],
      [[savedSearchesRow]],
    ] = await Promise.all([
      latestCvId
        ? pool.query(
            `SELECT COUNT(*) AS count
             FROM match_analyses m
             WHERE m.user_id = ?
               AND m.cv_id = ?
               AND m.score >= 70
               AND m.created_at >= (UTC_TIMESTAMP() - INTERVAL ? DAY)`,
            [req.user.id, latestCvId, windowDays],
          )
        : Promise.resolve([[{ count: 0 }]]),
      pool.query(
        `SELECT COUNT(*) AS count
         FROM outreach_contacts o
         WHERE o.user_id = ?
           AND o.next_follow_up_at IS NOT NULL
           AND o.next_follow_up_at <= UTC_TIMESTAMP()
           AND o.response_state IN ('none', 'not_now', 'referred')`,
        [req.user.id],
      ),
      pool.query(
        `SELECT
            SUM(CASE WHEN o.verification_status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
            SUM(CASE WHEN o.verification_status = 'exploratory' THEN 1 ELSE 0 END) AS exploratory_count,
            SUM(CASE WHEN o.priority_score >= 70 THEN 1 ELSE 0 END) AS high_priority_count
         FROM outreach_contacts o
         WHERE o.user_id = ?`,
        [req.user.id],
      ),
      pool.query('SELECT COUNT(*) AS count FROM saved_searches WHERE user_id = ?', [req.user.id]),
    ]);

    res.json({
      summary: {
        window_days: windowDays,
        has_cv: Boolean(latestCvId),
        new_matches_count: Number(newMatchesRow?.count ?? 0),
        follow_ups_due_count: Number(followUpsDueRow?.count ?? 0),
        outreach_verified_count: Number(outreachSummaryRow?.verified_count ?? 0),
        outreach_exploratory_count: Number(outreachSummaryRow?.exploratory_count ?? 0),
        outreach_high_priority_count: Number(outreachSummaryRow?.high_priority_count ?? 0),
        saved_searches_count: Number(savedSearchesRow?.count ?? 0),
      },
    });
  }),
);

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
