# HANDOFF — JobBridge (Kenya attachment search, Jan–Apr 2027)

## What this is
JobBridge is the one tool driving Alvin's Jan–Apr 2027 Nairobi attachment search: CV parsing/scoring, job matching across ATS connectors + scraped sources, and draft-only HR outreach. Node/Express/React/MySQL. hiring-agent (upstream Python resume scorer) was ported in early on and is no longer touched — not relevant to anything below.

## Where things stand (as of 2026-08-18)
Everything previously listed as pending (verification fields, scoring rules, lane split, onboarding checklist, reverify cron, Discovery Pack) is done. This session did a full correctness/security/performance review of that work and fixed what it found. Summary:

**Verified vs Exploratory lanes (jobs + outreach) — rewritten this session.**
The original outreach verification scoring (additive point system) had a real bug: a Kenyan company on its own careers domain could never reach "Verified" even after a passing live check — it topped out around 54 against a 70 threshold, while typing the word "verified" into a notes field was worth +28. Replaced with an evidence-tier model in `server/outreach/verification.js`:

| Tier | Condition | Base score |
|---|---|---|
| A | Trusted ATS host + live-verified within 60 days | 85 (decays 0/-8/-18 by age) |
| B | Own domain, live-verified within 60 days | 72 (same decay) |
| C | Trusted ATS host, never verified or expired (>60d) | 60 |
| D | Has a careers URL, never verified or expired | 45 |
| E | No careers URL | 20 |

Free text (`notes`/`source`) can only ever push a contact **down** to Exploratory (via `NEGATIVE_PATTERNS` — phrases like "not independently fetched"), never up — self-attestation isn't evidence. `is_example` is a hard demotion, not a subtraction (a flat subtraction would still have let an example contact on a trusted host clear 70). Verified against the real seeded data after rewriting: Moniepoint/Tala/Pesapal/M-KOPA (real ATS-backed) landed Verified; Wasoko/Cellulant (snippet-only leads) correctly stayed Exploratory — Wasoko specifically because its `source` field literally says "not independently fetched," which the negative-pattern rule catches even after its careers URL passes a live check.

Also fixed: `computeVerificationWithReliability` was scoring a just-passed live check against its *own pre-check* `last_verified_at`, so a check that just succeeded could still show the "verification is stale" penalty on the very run that disproved it. It now scores against the post-check state.

**Outreach re-score button vs. lazy re-score** — the button existed, but the lazy re-score-on-every-GET path it was meant to replace was still there: `GET /api/outreach` recomputed and wrote verification for every row on every page load — an unconditional UPDATE storm, since every pre-migration row had `NULL` reasons and always compared unequal. Removed; reads are read-only now. `POST /api/outreach/reverify` and the nightly cron are the only writers.

**Per-company freshness / dead-link decay** — the age-gating table above is the decay; a failed live check (`last_verification_error` set) demotes below the "never checked" state for that same host type, so a known-dead link scores worse than an untested one.

**Ashby + SmartRecruiters connectors** — both were live but silently degraded, confirmed against the real APIs:
- Ashby was building job URLs as `jobs.ashbyhq.com/job/<id>` (drops the org slug — 404s). Fixed to `jobs.ashbyhq.com/<slug>/<id>`, confirmed resolving live. Also now folds `secondaryLocations` into the stored location — M-KOPA lists several Nairobi/Kenya roles as secondary locations on postings primarily elsewhere, previously invisible to the Kenya-first sort.
- Neither connector's list/board endpoint carries full job descriptions (verified live) — description is now stored as `null` for these sources rather than a broken best-effort extraction that silently returned `''`. Getting real descriptions would need a per-posting detail fetch, deliberately not added (multiplies outbound requests per company per ingestion run).
- SmartRecruiters `remote` detection was silently always-false (`location.remote` is a boolean; the old code stringified and regex-matched it, which never matches `"true"` against `/remote/i`... actually never matches at all). Fixed to use the boolean directly.
- `inferEmploymentType` (`server/ingestion/normalize.js`) didn't recognize "attachment", "attachee", "graduate trainee", "apprentice", or "trainee" — the standard Kenyan vocabulary for what this tool calls "internship." Added; the `type=internship` filter was missing exactly the roles this tool exists to find.

**Nightly re-verification cron** — was silently firing 3 hours off-schedule: node-cron defaults to server-local time (host runs `Africa/Nairobi`, UTC+3), so `OUTREACH_REVERIFY_CRON_UTC` wasn't actually running in UTC despite its name. Fixed with `{ timezone: 'UTC' }` on all three schedules. Same class of bug one layer down: the MySQL pool had no timezone option, so `last_verified_at` (written as a JS `Date`) was serialized in local time while every filter query (`recent14`/`stale30`/etc.) compared it against `UTC_TIMESTAMP()` — fixed with `timezone: 'Z'` on the pool, verified against the real DB.

**Security hardening done this session** (scope: localhost/single-user, so this stopped short of auth/rate-limiting — see README's accepted-limitations note): the outreach live-URL checker was an unguarded SSRF vector reachable nightly and unattended (`careers_url: http://127.0.0.1:3306` would get fetched) — now blocks non-http(s) schemes and resolves+rejects private/loopback/link-local/CGNAT addresses on every redirect hop, tested live. `POST /api/ingest/run` was unauthenticated — now requires sign-in. Missing `SESSION_SECRET` now logs a loud warning instead of silently signing cookies with a well-known default.

**Performance fixes done this session:** ingestion batches all of a company's jobs into one multi-row `INSERT IGNORE` instead of one query per job; outreach reverify runs with bounded concurrency (6 at a time, shared per-URL check cache) instead of fully sequential — a run that could take 20+ minutes for 100 contacts with dead links now takes seconds for the current dataset (tested live: 10 contacts, 5 failures, ~2s); a race in the saved-search alert pass that could silently drop alerts for jobs inserted mid-pass by a concurrent ingestion run is fixed by scoping the `is_new` clear to exactly the ids considered.

**Tests added** — none existed before this session. `server/test/` covers the verification tier model (every tier, freshness boundaries at 14/30/60 days, the stale-then-refreshed regression, self-attestation not promoting), `computePriority`, the CV dedupe helpers, and `inferEmploymentType`. `npm test` runs them (38 passing).

**Kenya/Nairobi source onboarding checklist** — in `README.md`. Added note: some legitimate Kenyan careers pages (e.g. Safaricom's, confirmed live during this session) return HTTP 403 to the automated live-checker — a real site with bot-blocking, not a dead link. Manual verification still applies there; don't assume a 403 means the lead is bad.

## What's next
See `ROADMAP.md` — real email sending, Milestone 5 guided onboarding, more ATS connectors (Freshteam, Workable), BrighterMonday/Fuzu scraped sources (pending real selector inspection), auth upgrade to true magic links, FULLTEXT job search.

## Landmine (still applies — unchanged this session)
Your account's latest CV in the DB may still be **"CV - Tessy Ikiara (5).pdf"**, not Alvin's own — `ORDER BY id DESC LIMIT 1` picks whichever was uploaded last, everywhere in the codebase (CV score, job match, outreach drafting). This session did not touch CV data. **Re-upload Alvin's own CV before trusting any score/match/outreach output.**

## Resume prompt
"Continue JobBridge per HANDOFF.md and ROADMAP.md. Current state: lanes/verification/connectors/security/perf review is done and tested (see HANDOFF for what changed). Next up is whatever's at the top of ROADMAP.md's Now section."
