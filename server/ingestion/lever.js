import { htmlToText, inferEmploymentType, inferRemote, makeJob } from './normalize.js';

// Public Lever postings API — no auth required.
export async function fetchLever(companyName, { site }) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Lever ${site}: HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Lever ${site}: unexpected response shape`);

  return data.map((p) => {
    const location = p.categories?.location ?? null;
    return makeJob({
      company: companyName,
      title: p.text,
      location,
      remote: inferRemote({ location: location ?? '', workplaceType: p.workplaceType ?? '' }),
      employmentType: inferEmploymentType({ title: p.text, commitment: p.categories?.commitment ?? '' }),
      description: p.descriptionPlain?.trim() || htmlToText(p.description ?? ''),
      url: p.hostedUrl,
      source: 'lever',
      postedAt: p.createdAt ? new Date(p.createdAt) : null,
    });
  });
}
