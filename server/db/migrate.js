import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');

const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
await conn.query(sql);

await conn.query(
	"ALTER TABLE companies MODIFY COLUMN source_type ENUM('greenhouse', 'lever', 'scraped', 'ashby', 'smartrecruiters') NOT NULL",
);
await conn.query(
	"ALTER TABLE jobs MODIFY COLUMN source ENUM('greenhouse', 'lever', 'scraped', 'ashby', 'smartrecruiters') NOT NULL",
);

await ensureColumn(
	conn,
	'outreach_contacts',
	"verification_status ENUM('verified', 'exploratory') NOT NULL DEFAULT 'exploratory'",
);
await ensureColumn(conn, 'outreach_contacts', 'trust_score TINYINT UNSIGNED NOT NULL DEFAULT 0');
await ensureColumn(conn, 'outreach_contacts', 'verification_reasons JSON NULL');
await ensureColumn(conn, 'outreach_contacts', 'source_preset VARCHAR(100) NULL');
await ensureColumn(conn, 'outreach_contacts', 'contact_role VARCHAR(100) NULL');
await ensureColumn(conn, 'outreach_contacts', 'priority_score TINYINT UNSIGNED NOT NULL DEFAULT 0');
await ensureColumn(conn, 'outreach_contacts', 'priority_reasons JSON NULL');
await ensureColumn(conn, 'outreach_contacts', 'last_verified_at TIMESTAMP NULL');
await ensureColumn(conn, 'outreach_contacts', 'last_verification_error VARCHAR(512) NULL');
await ensureColumn(conn, 'outreach_contacts', 'last_contacted_at TIMESTAMP NULL');
await ensureColumn(conn, 'outreach_contacts', 'next_follow_up_at TIMESTAMP NULL');
await ensureColumn(conn, 'outreach_contacts', 'follow_up_count SMALLINT UNSIGNED NOT NULL DEFAULT 0');
await ensureColumn(
	conn,
	'outreach_contacts',
	"response_state ENUM('none', 'interested', 'not_now', 'rejected', 'referred') NOT NULL DEFAULT 'none'",
);
await ensureIndex(
	conn,
	'outreach_contacts',
	'idx_outreach_verification',
	'(user_id, verification_status, trust_score)',
);
await ensureIndex(
	conn,
	'outreach_contacts',
	'idx_outreach_priority',
	'(user_id, priority_score, next_follow_up_at)',
);

await conn.end();
console.log('Migration applied.');

async function ensureColumn(connection, table, ddl) {
	try {
		await connection.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
	} catch (err) {
		if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
	}
}

async function ensureIndex(connection, table, indexName, indexDef) {
	try {
		await connection.query(`ALTER TABLE ${table} ADD INDEX ${indexName} ${indexDef}`);
	} catch (err) {
		if (err?.code !== 'ER_DUP_KEYNAME') throw err;
	}
}
