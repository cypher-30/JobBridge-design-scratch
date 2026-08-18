import express from 'express';
import cookieSession from 'cookie-session';
import { config } from './config.js';
import { startIngestionCron } from './cron.js';
import { authRouter, currentUser } from './routes/auth.js';
import { jobsRouter } from './routes/jobs.js';
import { cvRouter } from './routes/cv.js';
import { analyzeRouter } from './routes/analyze.js';
import { ingestRouter } from './routes/ingest.js';
import { searchesRouter } from './routes/searches.js';
import { outreachRouter } from './routes/outreach.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(
  cookieSession({
    name: 'jobbridge',
    secret: config.sessionSecret,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax',
    httpOnly: true,
  }),
);

app.get('/api/me', async (req, res, next) => {
  try {
    res.json({ user: await currentUser(req) });
  } catch (err) {
    next(err);
  }
});
app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/cv', cvRouter);
app.use('/api', analyzeRouter);
app.use('/api/ingest', ingestRouter);
app.use('/api/searches', searchesRouter);
app.use('/api/outreach', outreachRouter);

// Central error handler — keeps route code on the happy path.
app.use((err, _req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal error' });
});

app.listen(config.port, () => {
  console.log(`JobBridge API listening on http://localhost:${config.port}`);
  startIngestionCron();
});
