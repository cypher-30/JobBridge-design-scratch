import { Router } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { pool } from '../db/pool.js';
import { requireAuth } from './auth.js';
import { parseCv } from '../llm/parseCv.js';
import { providerName } from '../llm/index.js';
import { scoreCv } from '../llm/scoreCv.js';
import { enrichFromGithub } from '../github/enrich.js';
import { loadRole } from '../roles/index.js';

export const cvRouter = Router();
const DEFAULT_ROLE = 'software_engineering_intern';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// POST /api/cv — multipart upload (field "file", PDF or DOCX).
// Extract text locally, send to the configured LLM for structured parsing,
// store as a NEW cv row (so cached match analyses for the old CV never leak).
cvRouter.post(
  '/',
  upload.single('file'),
  requireAuth(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Attach a PDF or DOCX file' });

    const rawText = await extractText(req.file);
    if (!rawText || rawText.trim().length < 100) {
      return res.status(422).json({
        error: 'Could not extract readable text from this file. If it is a scanned/image PDF, export a text-based version.',
      });
    }

    const parsed = await parseCv(rawText);
    const [result] = await pool.query(
      'INSERT INTO cvs (user_id, filename, raw_text, parsed) VALUES (?, ?, ?, ?)',
      [req.user.id, req.file.originalname, rawText, JSON.stringify(parsed)],
    );
    res.json({ cv: { id: result.insertId, filename: req.file.originalname, parsed }, provider: providerName() });
  }),
);

cvRouter.get(
  '/',
  requireAuth(async (req, res) => {
    const [[cv]] = await pool.query(
      'SELECT id, filename, parsed, updated_at FROM cvs WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [req.user.id],
    );
    if (!cv) return res.json({ cv: null });
    if (typeof cv.parsed === 'string') cv.parsed = JSON.parse(cv.parsed);
    res.json({ cv });
  }),
);

// PUT /api/cv — user corrections to the extracted data. Creates a new cv row
// (same raw text, corrected parse) so stale match analyses don't resurface.
cvRouter.put(
  '/',
  requireAuth(async (req, res) => {
    const parsed = req.body?.parsed;
    if (!parsed || typeof parsed !== 'object') {
      return res.status(400).json({ error: 'Body must include { parsed: {...} }' });
    }
    const [[current]] = await pool.query(
      'SELECT id, filename, raw_text FROM cvs WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [req.user.id],
    );
    if (!current) return res.status(404).json({ error: 'Upload a CV first' });

    const [result] = await pool.query(
      'INSERT INTO cvs (user_id, filename, raw_text, parsed) VALUES (?, ?, ?, ?)',
      [req.user.id, current.filename, current.raw_text, JSON.stringify(parsed)],
    );
    res.json({ cv: { id: result.insertId, filename: current.filename, parsed } });
  }),
);

// POST /api/cv/score — compute (or recompute) the role-scoped CV quality
// score for the user's latest CV, enriching with GitHub signal when a
// github_url was extracted. Cached per (cv_id, role); GET returns the cache.
cvRouter.post(
  '/score',
  requireAuth(async (req, res) => {
    const role = String(req.body?.role || DEFAULT_ROLE);
    const [[cv]] = await pool.query(
      'SELECT id, parsed FROM cvs WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [req.user.id],
    );
    if (!cv) return res.status(409).json({ error: 'Upload a CV first' });

    const parsedCv = typeof cv.parsed === 'string' ? JSON.parse(cv.parsed) : cv.parsed;
    const roleDef = await loadRole(role);

    let enrichment = null;
    let githubError = null;
    if (parsedCv.github_url) {
      try {
        enrichment = await enrichFromGithub(parsedCv.github_url, roleDef.positionTitle);
      } catch (err) {
        githubError = err.message;
        console.warn(`[cv/score] GitHub enrichment failed for cv=${cv.id}: ${err.message}`);
      }
    }

    const result = await scoreCv(parsedCv, role, enrichment);

    await pool.query(
      `INSERT INTO cv_quality_scores
         (cv_id, role, scores, bonus_total, deductions_total, final_score, key_strengths, areas_for_improvement, github_username)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         scores = VALUES(scores), bonus_total = VALUES(bonus_total), deductions_total = VALUES(deductions_total),
         final_score = VALUES(final_score), key_strengths = VALUES(key_strengths),
         areas_for_improvement = VALUES(areas_for_improvement), github_username = VALUES(github_username),
         created_at = CURRENT_TIMESTAMP`,
      [
        cv.id,
        role,
        JSON.stringify(result.scores),
        result.bonus_points.total,
        result.deductions.total,
        result.final_score,
        JSON.stringify(result.key_strengths),
        JSON.stringify(result.areas_for_improvement),
        result.github_username,
      ],
    );

    res.json({ score: result, github_error: githubError });
  }),
);

cvRouter.get(
  '/score',
  requireAuth(async (req, res) => {
    const role = String(req.query.role || DEFAULT_ROLE);
    const [[cv]] = await pool.query(
      'SELECT id FROM cvs WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [req.user.id],
    );
    if (!cv) return res.json({ score: null });

    const [[row]] = await pool.query(
      'SELECT scores, bonus_total, deductions_total, final_score, key_strengths, areas_for_improvement, github_username, created_at FROM cv_quality_scores WHERE cv_id = ? AND role = ?',
      [cv.id, role],
    );
    if (!row) return res.json({ score: null });

    const roleDef = await loadRole(role);
    res.json({
      score: {
        role,
        scores: parseMaybe(row.scores),
        bonus_points: { total: row.bonus_total },
        deductions: { total: row.deductions_total },
        key_strengths: parseMaybe(row.key_strengths),
        areas_for_improvement: parseMaybe(row.areas_for_improvement),
        final_score: row.final_score,
        max_final_score: roleDef.maxFinalScore,
        github_username: row.github_username,
        created_at: row.created_at,
      },
    });
  }),
);

const parseMaybe = (v) => (typeof v === 'string' ? JSON.parse(v) : v ?? []);

async function extractText(file) {
  const name = file.originalname.toLowerCase();
  const isPdf = file.mimetype === 'application/pdf' || name.endsWith('.pdf');
  const isDocx =
    file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx');

  if (isPdf) {
    const { text } = await pdfParse(file.buffer);
    return text;
  }
  if (isDocx) {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return value;
  }
  const err = new Error('Unsupported file type — upload a PDF or DOCX');
  err.status = 400;
  throw err;
}
