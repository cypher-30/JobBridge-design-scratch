import { Router } from 'express';
import { pool } from '../db/pool.js';
import { buildJobFilters } from '../jobFilters.js';
import { currentUser } from './auth.js';
import { jobLaneCaseSql, jobLaneWhereSql, jobTrustCaseSql } from '../lanes.js';

export const jobsRouter = Router();

const PAGE_SIZE = 30;

// GET /api/jobs?q=&location=&remote=&type=&min_score=&lane=&sort=newest|match&page=1
// When the requester has an uploaded CV, each job row carries its cached match
// analysis (score/summary/skills/suggestions) for that CV, enabling
// sort-by-match and min-score filtering.
jobsRouter.get('/', async (req, res, next) => {
  try {
    const user = await currentUser(req);
    let cvId = null;
    if (user) {
      const [[cv]] = await pool.query(
        'SELECT id FROM cvs WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [user.id],
      );
      cvId = cv?.id ?? null;
    }

    const { where, params } = buildJobFilters(req.query);

    const join = cvId
      ? 'LEFT JOIN match_analyses m ON m.job_id = j.id AND m.user_id = ? AND m.cv_id = ?'
      : '';
    const joinParams = cvId ? [user.id, cvId] : [];

    const minScore = Number(req.query.min_score);
    if (cvId && Number.isFinite(minScore) && minScore > 0) {
      where.push('m.score >= ?');
      params.push(minScore);
    }

    const lane = String(req.query.lane || '').toLowerCase();
    const laneWhere = jobLaneWhereSql(lane);
    if (laneWhere) where.push(laneWhere);

    const kenyaFirstSort =
      lane === 'verified'
        ? "CASE WHEN LOWER(COALESCE(j.location, '')) REGEXP '(^|[^a-z])(nairobi|kenya)([^a-z]|$)' THEN 0 ELSE 1 END, "
        : '';

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const laneCols = `${jobLaneCaseSql()} AS verification_lane, ${jobTrustCaseSql()} AS trust_score`;
    const scoreSelect = cvId
      ? `m.score AS match_score, m.summary AS match_summary, m.matching_skills, m.missing_skills, m.suggestions, ${laneCols}`
      : `NULL AS match_score, NULL AS match_summary, NULL AS matching_skills, NULL AS missing_skills, NULL AS suggestions, ${laneCols}`;

    const sort =
      req.query.sort === 'match' && cvId
        ? `ORDER BY ${kenyaFirstSort}(m.score IS NULL), m.score DESC, j.first_seen_at DESC`
        : `ORDER BY ${kenyaFirstSort}COALESCE(j.posted_at, j.first_seen_at) DESC`;

    const page = Math.max(1, Number(req.query.page) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM jobs j ${join} ${whereSql}`,
      [...joinParams, ...params],
    );
    const [rows] = await pool.query(
      `SELECT j.id, j.company, j.title, j.location, j.remote, j.employment_type,
              j.url, j.source, j.posted_at, j.first_seen_at, ${scoreSelect}
       FROM jobs j ${join} ${whereSql} ${sort} LIMIT ? OFFSET ?`,
      [...joinParams, ...params, PAGE_SIZE, offset],
    );

    res.json({
      jobs: rows.map(parseJsonColumns),
      total,
      page,
      pageSize: PAGE_SIZE,
      hasCv: Boolean(cvId),
    });
  } catch (err) {
    next(err);
  }
});

function parseJsonColumns(row) {
  for (const col of ['matching_skills', 'missing_skills', 'suggestions']) {
    if (typeof row[col] === 'string') row[col] = JSON.parse(row[col]);
  }
  return row;
}
