# ROADMAP — JobBridge

Where this is headed. For what's already done and why, see `README.md` (how it works today) and `HANDOFF.md` (what changed most recently and why).

## Now (next up)

1. **Real email delivery.** `server/email/sender.js` is a console-stub interface. Pick a provider (SMTP, Resend, or SES), implement it behind the existing `EmailSender` interface, switch on an `EMAIL_PROVIDER` env var. Unblocks both saved-search alerts (Milestone 4) and a real magic-link login (below).
2. **More ATS connectors: Freshteam, Workable.** Pesapal is already tracked as `freshteam` source_type conceptually via outreach, but there's no `server/ingestion/freshteam.js` fetcher yet — jobs from Freshteam-hosted boards currently only show up via manual outreach entries, not the Jobs page. Workable is common among Kenyan/African startups not yet covered by Greenhouse/Lever/Ashby/SmartRecruiters. Same pattern as the existing connectors in `server/ingestion/`: fetch, normalize via `makeJob`, register in `FETCHERS` (`server/ingestion/index.js`), add to `server/lanes.js`'s trusted-source list and trust score table, add a `companies.json` section + README instructions.
3. **BrighterMonday Kenya and Fuzu scraped sources.** Flagged as promising in `config/companies.json`'s research notes but not added — a markdown-rendered fetch can't reliably yield real CSS selectors; needs a real browser devtools inspection pass before adding scraper entries, to avoid guessing and shipping broken selectors.

## Soon

4. **Magic-link login**, once real email delivery exists — replace (or offer alongside) the current email-only sign-in with an actual verification step, closing the "anyone can sign in as any email" accepted limitation in the README's Security section.
5. **Milestone 5 guided onboarding** — first-time-user wizard (role type, internship vs job, industries) that pre-fills filters and saves the result as their first saved search.
6. **FULLTEXT search on `jobs.description`.** The `q` filter currently does `LIKE '%...%'` over a MEDIUMTEXT column — fine at current volume, won't scale past a few thousand rows without a real index.
7. **Per-posting description fetch for Ashby/SmartRecruiters**, if match-quality on those sources turns out to matter enough to justify the extra per-company request volume during ingestion. Deliberately skipped so far (see HANDOFF) — revisit if/when Ashby/SmartRecruiters postings become a meaningful share of Kenya volume and title-only matching proves too weak.

## Eventually / opportunistic

8. **Kenya-first sort as an indexed column.** `routes/jobs.js`'s Kenya-first ORDER BY is a per-row REGEXP today (fine at current volume, forces a filesort). If the jobs table grows meaningfully, promote to a generated+indexed `is_kenya` column.
9. **Integration/DB-backed tests.** `server/test/` currently covers pure functions only (verification scoring, priority scoring, CV dedupe, employment-type inference) via `node --test`. No tests touch the DB or HTTP routes yet — worth adding once the schema/route surface stabilizes further, so route changes get real regression coverage instead of relying on manual `curl` checks against a live dev server.
10. **Rate limiting on LLM-calling routes**, if this tool is ever exposed beyond a single local user — currently an accepted limitation (see README Security section).
11. **Real auth**, same trigger as above.

## Explicitly not planned

- hiring-agent (upstream Python resume scorer) stays upstream-tracked only. Nothing further gets ported from it; JobBridge's role-scoring logic (`server/roles/`) is now the canonical copy.
- No outbound email sending on the user's behalf, ever, for outreach — drafts are generated, reviewed, and sent manually by design (see README/HANDOFF). This is a product decision, not a missing feature.
