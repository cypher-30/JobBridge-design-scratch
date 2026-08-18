import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from './auth.js';

export const searchesRouter = Router();

searchesRouter.get(
  '/',
  requireAuth(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, name, filters, created_at FROM saved_searches WHERE user_id = ? ORDER BY id DESC',
      [req.user.id],
    );
    res.json({
      searches: rows.map((r) => ({ ...r, filters: typeof r.filters === 'string' ? JSON.parse(r.filters) : r.filters })),
    });
  }),
);

searchesRouter.post(
  '/',
  requireAuth(async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 255);
    const filters = req.body?.filters;
    if (!name) return res.status(400).json({ error: 'Give the search a name' });
    if (!filters || typeof filters !== 'object') return res.status(400).json({ error: 'Missing filters' });

    // Only persist the filter keys alerts/search understand.
    const clean = {
      q: String(filters.q ?? '').trim(),
      location: String(filters.location ?? '').trim(),
      remote: Boolean(filters.remote),
      type: String(filters.type ?? ''),
    };
    const [result] = await pool.query(
      'INSERT INTO saved_searches (user_id, name, filters) VALUES (?, ?, ?)',
      [req.user.id, name, JSON.stringify(clean)],
    );
    res.json({ search: { id: result.insertId, name, filters: clean } });
  }),
);

searchesRouter.delete(
  '/:id',
  requireAuth(async (req, res) => {
    await pool.query('DELETE FROM saved_searches WHERE id = ? AND user_id = ?', [
      Number(req.params.id),
      req.user.id,
    ]);
    res.json({ ok: true });
  }),
);
