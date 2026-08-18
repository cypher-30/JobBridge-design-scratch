import { Router } from 'express';
import { pool } from '../db/pool.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Minimal email-only signup/login (spec: "magic-link style or simple session").
// No password; the signed session cookie is the credential. The email/sender
// interface is in place for real magic links in Milestone 4.
authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });

  await pool.query('INSERT IGNORE INTO users (email) VALUES (?)', [email]);
  const [[user]] = await pool.query('SELECT id, email FROM users WHERE email = ?', [email]);
  req.session.userId = user.id;
  res.json({ user });
});

authRouter.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

export async function currentUser(req) {
  if (!req.session?.userId) return null;
  const [[user]] = await pool.query('SELECT id, email FROM users WHERE id = ?', [req.session.userId]);
  return user ?? null;
}

export function requireAuth(handler) {
  return async (req, res, next) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Sign in first' });
      req.user = user;
      return await handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}
