import { inferEmploymentType, makeJob } from './normalize.js';

// SmartRecruiters public postings API.
//
// Verified live against the postings list endpoint: it carries no `jobAd`
// key at all (only the per-posting detail endpoint does), so the previous
// description-building expression evaluated to '' unconditionally — for any
// input shape, `[x].flat().flatMap(s => Array.isArray(s) ? s : [])` reduces
// to `[]`. Left explicitly null here rather than fetching each posting's
// detail endpoint separately, matching the same low-request-footprint
// tradeoff made for the Ashby connector.
export async function fetchSmartRecruiters(companyName, { company_identifier: companyIdentifier }) {
  const identifier = String(companyIdentifier || '').trim();
  if (!identifier) throw new Error('SmartRecruiters config missing company_identifier');

  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(identifier)}/postings?limit=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SmartRecruiters ${identifier}: HTTP ${res.status}`);

  const data = await res.json();
  const jobs = data?.content;
  if (!Array.isArray(jobs)) throw new Error(`SmartRecruiters ${identifier}: unexpected response shape`);

  return jobs
    .filter((p) => p?.name && p?.id)
    .map((p) => {
      const location = p.location?.fullLocation || [p.location?.city, p.location?.region, p.location?.country]
        .filter(Boolean)
        .join(', ') || null;

      return makeJob({
        company: companyName,
        title: p.name,
        location,
        // `location.remote` is a boolean on this API — the previous code
        // stringified it (`String(true)` -> "true") and matched it against
        // /remote/i, which never matches, so remote was never detected.
        remote: Boolean(p.location?.remote),
        employmentType: inferEmploymentType({ title: p.name, commitment: p.typeOfEmployment?.label || '' }),
        description: null,
        url: `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${p.id}`,
        source: 'smartrecruiters',
        postedAt: p.releasedDate ? new Date(p.releasedDate) : null,
      });
    });
}
