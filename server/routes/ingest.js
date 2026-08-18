import { Router } from 'express';
import { runIngestion } from '../ingestion/index.js';
import { requireAuth } from './auth.js';

export const ingestRouter = Router();

// Manual trigger for testing/admin. Triggers outbound fetches to every
// active company plus alert-email delivery — gated behind sign-in so it
// isn't a free-for-all endpoint for anyone who can reach the port.
ingestRouter.post(
  '/run',
  requireAuth(async (_req, res) => {
    const summary = await runIngestion();
    res.json({ summary });
  }),
);
