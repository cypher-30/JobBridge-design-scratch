-- JobBridge schema. Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS companies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  source_type ENUM('greenhouse', 'lever', 'scraped', 'ashby', 'smartrecruiters') NOT NULL,
  config JSON NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_companies_name_source (name, source_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company VARCHAR(255) NOT NULL,
  title VARCHAR(512) NOT NULL,
  location VARCHAR(255) NULL,
  remote BOOLEAN NOT NULL DEFAULT FALSE,
  employment_type ENUM('full-time', 'internship', 'contract', 'other') NOT NULL DEFAULT 'other',
  description MEDIUMTEXT NULL,
  url VARCHAR(1024) NOT NULL,
  source ENUM('greenhouse', 'lever', 'scraped', 'ashby', 'smartrecruiters') NOT NULL,
  posted_at DATETIME NULL,
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_new BOOLEAN NOT NULL DEFAULT TRUE,
  dedupe_key CHAR(40) NOT NULL,
  UNIQUE KEY uq_jobs_dedupe (dedupe_key),
  KEY idx_jobs_company (company),
  KEY idx_jobs_posted (posted_at),
  KEY idx_jobs_type (employment_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cvs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  filename VARCHAR(512) NOT NULL,
  raw_text MEDIUMTEXT NOT NULL,
  parsed JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_cvs_user (user_id),
  CONSTRAINT fk_cvs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_analyses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  job_id INT UNSIGNED NOT NULL,
  cv_id INT UNSIGNED NOT NULL,
  score TINYINT UNSIGNED NOT NULL,
  matching_skills JSON NULL,
  missing_skills JSON NULL,
  suggestions JSON NULL,
  summary TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_match (user_id, job_id, cv_id),
  KEY idx_match_user_score (user_id, score),
  CONSTRAINT fk_match_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_match_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_match_cv FOREIGN KEY (cv_id) REFERENCES cvs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Milestone 4 stub: saved searches for alerting.
CREATE TABLE IF NOT EXISTS saved_searches (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  filters JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_saved_user (user_id),
  CONSTRAINT fk_saved_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Role-scoped CV quality score (ported from hiring-agent's role-agnostic rubric:
-- GitHub-signal-aware, job-posting-independent). Complements match_analyses,
-- which scores fit to one specific posting.
CREATE TABLE IF NOT EXISTS cv_quality_scores (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cv_id INT UNSIGNED NOT NULL,
  role VARCHAR(100) NOT NULL,
  scores JSON NOT NULL,
  bonus_total SMALLINT NOT NULL DEFAULT 0,
  deductions_total SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  final_score SMALLINT NOT NULL,
  key_strengths JSON NULL,
  areas_for_improvement JSON NULL,
  github_username VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cv_quality (cv_id, role),
  CONSTRAINT fk_quality_cv FOREIGN KEY (cv_id) REFERENCES cvs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Outreach pool: companies/startups to contact directly (e.g. Kenya/Nairobi
-- attachments), with an LLM-drafted email per contact. Drafts are stored for
-- review — JobBridge never sends outreach email on the user's behalf.
CREATE TABLE IF NOT EXISTS outreach_contacts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  sector VARCHAR(255) NULL,
  location VARCHAR(255) NULL,
  careers_url VARCHAR(1024) NULL,
  contact_name VARCHAR(255) NULL,
  contact_email VARCHAR(320) NULL,
  source VARCHAR(255) NULL,
  source_preset VARCHAR(100) NULL,
  contact_role VARCHAR(100) NULL,
  notes TEXT NULL,
  tech_stack JSON NULL,
  why_fit TEXT NULL,
  accepts_attachments ENUM('true', 'false', 'unknown') NOT NULL DEFAULT 'unknown',
  verification_status ENUM('verified', 'exploratory') NOT NULL DEFAULT 'exploratory',
  trust_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  verification_reasons JSON NULL,
  priority_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  priority_reasons JSON NULL,
  last_verified_at TIMESTAMP NULL,
  last_verification_error VARCHAR(512) NULL,
  last_contacted_at TIMESTAMP NULL,
  next_follow_up_at TIMESTAMP NULL,
  follow_up_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  response_state ENUM('none', 'interested', 'not_now', 'rejected', 'referred') NOT NULL DEFAULT 'none',
  status ENUM('not_contacted', 'drafted', 'sent', 'replied') NOT NULL DEFAULT 'not_contacted',
  draft_subject VARCHAR(500) NULL,
  draft_body TEXT NULL,
  draft_generated_at TIMESTAMP NULL,
  is_example BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_outreach_user (user_id),
  KEY idx_outreach_status (user_id, status),
  KEY idx_outreach_verification (user_id, verification_status, trust_score),
  KEY idx_outreach_priority (user_id, priority_score, next_follow_up_at),
  CONSTRAINT fk_outreach_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
