import mysql from 'mysql2/promise';
import { config } from '../config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  // The host runs in local time (e.g. Africa/Nairobi, UTC+3), but every
  // freshness/follow-up query in the app filters with UTC_TIMESTAMP() and
  // INTERVAL arithmetic in SQL. Without this, a JS Date written here (e.g.
  // last_verified_at = new Date()) is serialized in local time, silently
  // skewing every "verified in the last N days" / "follow-up due" filter by
  // the host's UTC offset. 'Z' makes the driver treat/convert all dates as UTC.
  timezone: 'Z',
});
