import { inferEmploymentType, makeJob } from './normalize.js';

// Ashby hosted jobs pages embed a JSON payload in window.__appData.
// We parse that payload and map jobPostings into normalized jobs.
//
// Verified live against jobs.ashbyhq.com/M-KOPA: jobPostings entries carry
// no `jobDescriptionHtml` and no `externalLink` (actual keys: id, title,
// teamId, locationId, locationName, workplaceType, employmentType,
// secondaryLocations, compensationTierSummary) — the board listing payload
// doesn't include full descriptions; only Ashby's per-posting page does.
// Fetching each posting individually would multiply outbound requests per
// company per ingestion run, so — like the scraper connector's listing-page
// jobs — description is left explicitly null rather than silently empty.
export async function fetchAshby(companyName, { hosted_jobs_page: hostedJobsPage }) {
  const slug = String(hostedJobsPage || '').trim();
  if (!slug) throw new Error('Ashby config missing hosted_jobs_page');

  const url = `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ashby ${slug}: HTTP ${res.status}`);

  const html = await res.text();
  const appData = extractAppData(html);
  const postings = appData?.jobBoard?.jobPostings;
  if (!Array.isArray(postings)) throw new Error(`Ashby ${slug}: missing jobBoard.jobPostings`);

  return postings
    .filter((p) => p && p.title)
    .map((p) => {
      // Fold secondary locations into the stored location string — Ashby
      // orgs commonly list one primary location (e.g. "London") with
      // Kenya/Nairobi only as a secondary location, which the Kenya-first
      // sort and any location filter would otherwise miss entirely.
      const secondary = Array.isArray(p.secondaryLocations)
        ? p.secondaryLocations.map((l) => l?.locationName).filter(Boolean)
        : [];
      const location = [p.locationName, ...secondary].filter(Boolean).join(', ') || null;
      const remote = /remote/i.test(p.workplaceType || '');

      // Board postings are hosted at /<org-slug>/<posting-id>, not /job/<id>
      // — the latter drops the slug and 404s. externalLink is kept as a
      // defensive fallback in case a future payload shape includes it.
      const finalUrl =
        p.externalLink || new URL(`/${encodeURIComponent(slug)}/${encodeURIComponent(p.id)}`, url).href;

      return makeJob({
        company: companyName,
        title: p.title,
        location,
        remote,
        employmentType: inferEmploymentType({ title: p.title, commitment: p.employmentType || '' }),
        description: null,
        url: finalUrl,
        source: 'ashby',
        postedAt: p.publishedDate ? new Date(p.publishedDate) : null,
      });
    });
}

function extractAppData(html) {
  const marker = 'window.__appData = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('Ashby page missing appData marker');

  const from = start + marker.length;
  const jsonStart = html.indexOf('{', from);
  if (jsonStart === -1) throw new Error('Ashby appData JSON start not found');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const json = html.slice(jsonStart, i + 1);
        return JSON.parse(json);
      }
    }
  }

  throw new Error('Ashby appData JSON end not found');
}
