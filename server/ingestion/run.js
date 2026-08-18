// CLI entry: npm run ingest
import { pool } from '../db/pool.js';
import { runIngestion } from './index.js';

const summary = await runIngestion();
console.table(summary);
await pool.end();
