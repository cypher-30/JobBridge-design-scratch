# JobBridge

JobBridge helps job seekers — especially students and people new to job hunting — find relevant jobs and internships fast, including from companies that post directly on their own career pages. Upload your CV once and JobBridge tells you exactly how well you match each posting and what to improve.

**How it works:**
1. A scheduled pipeline ingests postings from ATS APIs (Greenhouse, Lever, Ashby, SmartRecruiters) and best-effort career-page scraping into a normalized `jobs` table.
2. You sign in with just your email and upload your CV (PDF/DOCX). An LLM extracts a structured profile (skills, experience, education, roles, certifications) that you can review and correct.
3. For any posting, JobBridge calls the LLM with your profile + the job description and returns a match score (0–100), the skills you already have, the ones you're missing, and concrete suggestions ("build X this week", "highlight project Y").

## Stack

- **Server:** Node.js 20+ (built on 24), Express, MySQL 8 (`mysql2`, plain SQL), `node-cron`, Cheerio
- **Client:** React + Vite, plain CSS
- **LLM:** pluggable provider — **Claude** (`@anthropic-ai/sdk`) or **Gemini** (`@google/genai`), switched by one env var. Both use schema-constrained JSON output (Claude structured outputs / Gemini `responseSchema`), so responses are guaranteed-valid JSON.

## Setup

### 1. Database

MySQL 8 must be running. Create the database and app user (adjust the password):

```sh
sudo mysql -e "
CREATE DATABASE IF NOT EXISTS jobbridge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'jobbridge'@'localhost' IDENTIFIED BY 'your-password';
CREATE USER IF NOT EXISTS 'jobbridge'@'127.0.0.1' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON jobbridge.* TO 'jobbridge'@'localhost';
GRANT ALL PRIVILEGES ON jobbridge.* TO 'jobbridge'@'127.0.0.1';
FLUSH PRIVILEGES;"
```

### 2. Environment

```sh
cp .env.example .env
```

Fill in:

| Variable | Notes |
|---|---|
| `DB_PASSWORD` | The password you used above |
| `LLM_PROVIDER` | `claude` or `gemini` — switch anytime, no code changes |
| `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` | Needed when provider is `claude` (default model `claude-opus-4-8`) |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Needed when provider is `gemini` |
| `INGEST_INTERVAL_MINUTES` | Ingestion cadence (default 30) |
| `OUTREACH_REVERIFY_CRON_UTC` | Nightly outreach re-verification cron in UTC (default `15 1 * * *`) |
| `OUTREACH_FOLLOWUP_AUDIT_CRON_UTC` | Nightly follow-up due audit cron in UTC (default `30 1 * * *`) |
| `SESSION_SECRET` | Any long random string |

### 3. Install, migrate, seed, run

```sh
npm install
npm run migrate        # applies server/db/schema.sql (idempotent)
npm run seed           # loads config/companies.json into the companies table
npm run dev            # starts API (:3001) + client (:5173) together
```

Open **http://localhost:5173**. Ingestion runs a few seconds after the server boots and then on the cron schedule; you can also trigger it manually:

```sh
npm run ingest                                # CLI
curl -X POST localhost:3001/api/ingest/run    # HTTP
```

## Adding companies to track

Edit `config/companies.json`, then run `npm run seed` — no code changes needed.

- **Greenhouse:** add `{ "token": "<slug>", "company_name": "..." }` under `greenhouse`. Find the slug in the company's job board URL (`boards.greenhouse.io/<slug>`).
- **Lever:** add `{ "site": "<slug>", "company_name": "..." }` under `lever` (`jobs.lever.co/<slug>`).
- **Ashby:** add `{ "hosted_jobs_page": "<slug>", "company_name": "..." }` under `ashby` (`jobs.ashbyhq.com/<slug>`).
- **SmartRecruiters:** add `{ "company_identifier": "<slug>", "company_name": "..." }` under `smartrecruiters` (`jobs.smartrecruiters.com/<slug>`).
- **Scraped (best-effort):** add a `careers_url` plus CSS selectors (`job_list_item`, `title`, `link`, optional `location`, `date_posted`). Without selectors, a heuristic scraper looks for job-like links. Scraped sources are lower-confidence and marked with a dashed badge in the UI; a broken scraper for one company never affects the others (per-company try/catch). Entries whose `company_name` starts with `EXAMPLE` are ignored by the seeder.

## API overview

| Endpoint | Description |
|---|---|
| `POST /api/auth/login` `{email}` | Email-only sign-in (creates the account on first use), sets a signed session cookie |
| `GET /api/me` | Current user |
| `GET /api/jobs` | Search/filter: `q`, `location`, `remote=1`, `type`, `min_score`, `lane=verified\|exploratory` (omit for all), `sort=newest\|match`, `page`. Rows include `verification_lane`, `trust_score`, and cached match data for your latest CV |
| `POST /api/cv` (multipart `file`) | Upload PDF/DOCX → text extraction → LLM structured parse |
| `GET /api/cv` / `PUT /api/cv` | Read / correct the extracted profile (corrections create a new CV version) |
| `POST /api/jobs/:id/analyze` | Match analysis for one job (cached per user + CV + job) |
| `POST /api/jobs/analyze-batch` `{job_ids}` | Up to 8 at once |
| `POST /api/ingest/run` | Manual ingestion trigger. **Requires sign-in.** |
| `GET /api/outreach` | List contacts. Filters: `status`, `verification_status=verified\|exploratory` (omit for all), `verified_age=recent14\|recent30\|stale30\|never`, `verified_sort=trust\|newest\|oldest`, `follow_up=due\|upcoming\|none`, `source_preset`, `contact_role`. Read-only — does not write scores (see below) |
| `POST` / `PUT /api/outreach[/:id]` | Add / edit a contact. Editing verification-relevant fields (careers URL, source, notes, location, email, etc.) re-scores and clears any stale live-check error; editing unrelated fields (e.g. draft text) doesn't discard existing live-check evidence |
| `GET /api/outreach/meta` | Discovery source presets + contact-role templates |
| `POST /api/outreach/reverify` | Live-checks every contact's careers URL (bounded concurrency, SSRF-guarded — see Security below) and refreshes trust/verification/freshness in one pass. Response includes a `failures` list (`company_name` + `error`) for the ones that didn't resolve, not just a count |
| `POST /api/outreach/:id/draft` | Generate/regenerate the LLM email draft. Draft-only — never sends |
| `POST /api/outreach/:id/followup` | Increment follow-up count and schedule the next follow-up |

`GET /api/outreach` deliberately does **not** recompute or write verification scores on read — only `POST /api/outreach/reverify` (the "Re-verify all links" button) and the nightly cron do. An earlier version recomputed and wrote on every list load, which turned every page view into an UPDATE storm.

Design notes:
- **Dedupe:** unique SHA1 of `company|title|url` (`jobs.dedupe_key`), inserted with `INSERT IGNORE` — re-runs never duplicate.
- **Analysis caching:** results are stored per `(user, job, cv)`. Correcting or re-uploading a CV creates a new CV version, so stale scores never resurface (they're recomputed on demand).
- **New-job flag:** `jobs.is_new` is set on first sight — this is the hook the Milestone 4 alert system will consume.

## Milestone 4: saved searches & alerts (done, email delivery stubbed)

- Save any filter combination from the Jobs page (name it, click enter). Saved searches appear as chips — click to re-apply, × to delete. API: `GET/POST/DELETE /api/searches`.
- After every ingestion run, jobs seen for the first time (`is_new = TRUE`) are matched against every saved search (same filter semantics as the search UI, via the shared `server/jobFilters.js`); one alert email is queued per matching search, then `is_new` is cleared so alerts never repeat.
- Delivery goes through `server/email/sender.js` — a pluggable interface. The default `ConsoleEmailSender` logs to stdout. **Remaining TODO:** implement a real sender (SMTP/Resend/SES) and switch on an `EMAIL_PROVIDER` env var; optionally upgrade login to true magic links using the same sender.

## Verification lanes (quality split)

To keep quality high while widening coverage, JobBridge uses two lanes:

- **Verified lane:** direct ATS/API-backed job sources (Greenhouse, Lever, Ashby, SmartRecruiters), plus outreach contacts whose live-checked evidence clears the trust threshold (70).
- **Exploratory lane:** best-effort scraped job sources and lower-confidence outreach leads. Useful for discovery, but validate before applying or sending outreach.

Jobs API accepts `lane=verified|exploratory` (or omit for all). Rows include `verification_lane` and `trust_score`. Within the **Verified** lane, Nairobi/Kenya postings are ranked ahead of non-Kenya postings, then the normal sort applies (newest/match).

### Outreach contact scoring — evidence tiers, not additive points

Outreach contacts store `verification_status`, `trust_score` (0–100), and `verification_reasons` (a plain-English list of why). Scoring (`server/outreach/verification.js`) picks the highest evidence tier that applies, then adds small modifiers:

| Tier | Condition | Base score |
|---|---|---|
| A | Trusted ATS host (Greenhouse/Lever/Ashby/SmartRecruiters/etc.) + live-verified within 60 days | 85, decaying 0 / −8 / −18 at 15 / 31 / 61+ days |
| B | Own careers domain, live-verified within 60 days | 72, same decay |
| C | Trusted ATS host, never live-verified or verification expired | 60 |
| D | Has a careers URL, never live-verified or verification expired | 45 |
| E | No careers URL | 20 |

Modifiers: +6 Kenya/Nairobi location, +5 non-placeholder contact email, +5 explicitly attachment-friendly, +4 high-signal discovery source (`ats_board`/`official_careers_page`/`direct_referral`). A failed live check (`last_verification_error` set) demotes **below** the same host type's never-checked tier — a known-dead link is worse evidence than an untested one.

**Free text (`source`/`notes`) can only demote, never promote.** Certain phrases ("search snippet only", "not independently fetched", "could not independently confirm", etc.) cap a contact at Exploratory regardless of score — but writing "verified" in a notes field does nothing on its own; only an actual live check moves the tier. `is_example` similarly forces Exploratory outright rather than just subtracting points, so a placeholder can never accidentally clear the threshold.

The Outreach Discovery Pack adds `source_preset`, `contact_role`, `priority_score`, `priority_reasons`, `response_state`, `last_contacted_at`, `next_follow_up_at`, `follow_up_count`. The outreach list supports `verified_age` filters (`recent14`, `recent30`, `stale30`, `never`), `verified_sort` (`trust`, `newest`, `oldest`), `follow_up` filters (`due`, `upcoming`, `none`), plus source-preset and contact-role filters.

Use `POST /api/outreach/reverify` (UI button: "Re-verify all links") to live-check every contact's careers URL and refresh trust/verification/freshness in one pass — bounded to 6 concurrent checks, with an SSRF guard (see Security below) and a shared cache so two contacts pointing at the identical URL only fetch it once. `GET /api/outreach` never writes scores itself; only reverify (manual or the nightly cron) does.

**Known false negative:** some legitimate careers pages return HTTP 403 to automated checks (bot-protection, not a dead link) — Safaricom's did during testing. A 403 means "verify by hand," not "the lead is bad."

## Outreach Discovery Pack (startup + proactive targeting)

The Outreach page now supports proactive company targeting even when no job is posted:

- **Discovery source presets:** VC portfolio, accelerator/incubator, direct referral, ATS board, official careers page, LinkedIn company page, demo-day/event, and more.
- **Contact-role templates:** HR Manager, Talent Acquisition, People Ops, Engineering Manager, CTO/Head of Engineering, Founder/Co-founder.
- **Priority scoring:** each lead gets `priority_score` (0-100) and `priority_reasons`, combining verification/trust, Kenya/Nairobi relevance, attachment friendliness, role quality, source quality, and follow-up urgency.
- **Follow-up workflow:** schedule next follow-up per lead, track follow-up count, and track response state (`none`, `interested`, `not_now`, `rejected`, `referred`).

Recommended weekly cadence for a 3-month attachment search:

1. Add 20-30 new leads with source presets and role templates.
2. Re-verify links once (manual button) and review priority ranking.
3. Send outreach to top-priority leads first.
4. Set follow-ups at 7-14 days for every outreach sent.
5. Work through the "follow-up due" filter daily.

## Kenya/Nairobi source onboarding checklist

Before treating a new lead as **Verified**, run this checklist. Note: none of steps 1–5 grant Verified by themselves anymore — only a passing live check (step 2, via "Re-verify all links") does, per the tier model above.

1. Confirm the company has an official careers page or ATS board (not only a search snippet).
2. Open at least one live posting, confirm it resolves, then run "Re-verify all links" (or wait for the nightly cron) so the trust score reflects an actual live check, not just a URL you eyeballed.
3. Confirm location relevance (`Kenya`, `Nairobi`, or clearly remote-eligible for your target) — worth +6 trust.
4. Capture source evidence in notes anyway (where/when/how you looked at it) — this is an audit trail for you, not a scoring input; watch for phrasing like "not independently fetched" or "search snippet only", which actively caps the lead at Exploratory.
5. Avoid placeholder/example emails and placeholder domains.
6. A 403 on the live check can mean bot-blocking on a real site, not a dead lead (Safaricom's careers page does this) — don't discard on a 403 alone; verify by hand once.
7. Re-check time-sensitive leads before applying/outreach (postings close quickly) — freshness decays automatically (see table above), so a lead re-verified 45 days ago is already showing reduced trust.

## Security

JobBridge is built to run as a personal, localhost tool for one user. What's actually enforced vs. what's an accepted limitation at that scope:

**Enforced:**
- The outreach live-URL checker resolves and rejects loopback/RFC1918/link-local/CGNAT addresses (blocks e.g. `careers_url: http://169.254.169.254/...` or `http://127.0.0.1:3306`) on every redirect hop, and only allows `http`/`https`. This matters because the checker runs unattended on the nightly cron across every stored `careers_url`.
- `POST /api/ingest/run` requires sign-in (it triggers outbound fetches to every tracked company plus alert-email delivery).
- A missing `SESSION_SECRET` logs a startup warning rather than silently signing session cookies with a well-known default.
- All SQL is parameterized; no string-built queries take unescaped user input.

**Accepted limitations (documented, not fixed, at single-user/localhost scope):**
- Login is email-only with no verification — anyone who can reach the port can sign in as any email address. Fine for a tool one person runs locally; would need real auth before being exposed beyond that.
- No rate limiting on the LLM-calling routes (`/api/cv`, `/api/jobs/:id/analyze`, `/api/outreach/:id/draft`) — a concern for API cost/abuse if ever exposed, not for a single local user.
- The central error handler returns `err.message` on 500s, which can include SQL error detail — acceptable for local debugging, not for a public deployment.

If this ever moves beyond localhost/single-user, address the "accepted limitations" list first.

## Testing

```sh
npm test
```

Runs `node --test` over `server/test/` — unit tests for the outreach verification tier model (every tier, the 14/30/60-day freshness boundaries, the "stale-then-refreshed" scoring regression, self-attestation not being able to promote a contact), `computePriority`, the CV-parsing dedupe helpers, and `inferEmploymentType`. No integration/DB tests yet — see `ROADMAP.md`.

## TODO — Milestone 5: guided onboarding (follow-up session)

For first-time users who don't know how job searching works: a short "What are you looking for?" flow (role type, internship vs job, industries) that pre-fills the filter panel and saves it as their first saved search. See `ROADMAP.md` for this and everything else planned next.

## Notes & limitations

- Scraped job listings, and Ashby/SmartRecruiters listings (verified live — neither connector's list endpoint carries a full description), usually lack full descriptions; match analysis for them judges from title/company (the prompt handles this explicitly).
- Scanned/image-only PDFs can't be parsed — export a text-based PDF.
- Outbound requests are forced to IPv4 (`server/config.js`) because some environments (e.g. WSL2 with DNS64) hang on unroutable IPv6.
- Gemini free-tier rate limits (429/503) are retried with exponential backoff.
- The nightly outreach-reverify and follow-up-audit crons run on genuine UTC (`{ timezone: 'UTC' }` in `server/cron.js`) and the DB pool stores/reads timestamps as UTC (`timezone: 'Z'` in `server/db/pool.js`) — both matter if the host's local timezone isn't UTC (this dev host runs `Africa/Nairobi`, UTC+3); without them, "verified in the last 14 days" and the cron's actual firing time silently drift by the host's offset.
