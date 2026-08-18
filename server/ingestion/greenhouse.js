import { htmlToText, inferEmploymentType, inferRemote, makeJob } from './normalize.js';

// Public Greenhouse job board API — no auth required.
export async function fetchGreenhouse(companyName, { token }) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Greenhouse ${token}: HTTP ${res.status}`);
  const data = await res.json();

  return (data.jobs ?? []).map((j) => {
    const location = j.location?.name ?? null;
    return makeJob({
      company: companyName,
      title: j.title,
      location,
      remote: inferRemote({ location: location ?? '' }),
      employmentType: inferEmploymentType({ title: j.title }),
      description: htmlToText(decodeEntities(j.content ?? '')),
      url: j.absolute_url,
      source: 'greenhouse',
      postedAt: j.updated_at ? new Date(j.updated_at) : null,
    });
  });
}

// Greenhouse returns `content` HTML-escaped (&lt;p&gt;...). Unescape before stripping tags.
function decodeEntities(s) {
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}
