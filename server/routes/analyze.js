import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from './auth.js';
import { matchJob } from '../llm/matchJob.js';

export const analyzeRouter = Router();

const BATCH_LIMIT = 8;

// POST /api/jobs/:id/analyze — score the user's latest CV against one job.
// Results are cached per (user, job, cv); repeat calls are free.
analyzeRouter.post(
  '/jobs/:id/analyze',
  requireAuth(async (req, res) => {
    const analysis = await analyzeOne(req.user.id, Number(req.params.id));
    res.json({ analysis });
  }),
);

// POST /api/jobs/analyze-batch { job_ids: [...] } — up to 8 at a time.
analyzeRouter.post(
  '/jobs/analyze-batch',
  requireAuth(async (req, res) => {
    const ids = [...new Set((req.body?.job_ids ?? []).map(Number).filter(Number.isInteger))].slice(0, BATCH_LIMIT);
    if (!ids.length) return res.status(400).json({ error: 'Provide job_ids: number[]' });

    const settled = await Promise.allSettled(ids.map((id) => analyzeOne(req.user.id, id)));
    const results = settled.map((s, i) =>
      s.status === 'fulfilled' ? { job_id: ids[i], analysis: s.value } : { job_id: ids[i], error: s.reason.message },
    );
    res.json({ results });
  }),
);

async function analyzeOne(userId, jobId) {
  const [[cv]] = await pool.query(
    'SELECT id, parsed FROM cvs WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    [userId],
  );
  if (!cv) {
    const err = new Error('Upload a CV first');
    err.status = 409;
    throw err;
  }

  const [[cached]] = await pool.query(
    'SELECT score, summary, matching_skills, missing_skills, suggestions FROM match_analyses WHERE user_id = ? AND job_id = ? AND cv_id = ?',
    [userId, jobId, cv.id],
  );
  if (cached) {
    console.log(`[analyze] cache hit user=${userId} job=${jobId} cv=${cv.id}`);
    return hydrate(cached, jobId);
  }

  const [[job]] = await pool.query('SELECT * FROM jobs WHERE id = ?', [jobId]);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }

  const parsedCv = typeof cv.parsed === 'string' ? JSON.parse(cv.parsed) : cv.parsed;
  const result = await matchJob(parsedCv, job);

  await pool.query(
    `INSERT IGNORE INTO match_analyses (user_id, job_id, cv_id, score, summary, matching_skills, missing_skills, suggestions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, jobId, cv.id, result.score, result.summary, JSON.stringify(result.matching_skills), JSON.stringify(result.missing_skills), JSON.stringify(result.suggestions)],
  );
  console.log(`[analyze] computed user=${userId} job=${jobId} cv=${cv.id} score=${result.score}`);
  return { job_id: jobId, ...result };
}

function hydrate(row, jobId) {
  return {
    job_id: jobId,
    score: row.score,
    summary: row.summary,
    matching_skills: parseMaybe(row.matching_skills),
    missing_skills: parseMaybe(row.missing_skills),
    suggestions: parseMaybe(row.suggestions),
  };
}

const parseMaybe = (v) => (typeof v === 'string' ? JSON.parse(v) : v ?? []);
