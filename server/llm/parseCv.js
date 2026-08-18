import { generateJson } from './index.js';

// Shared JSON schema (Claude structured outputs + Gemini responseSchema after sanitizing).
// Kept to plain types — no anyOf/null — so it works identically on both providers.
const CV_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['full_name', 'summary', 'skills', 'years_of_experience', 'education', 'past_roles', 'certifications', 'github_url'],
  properties: {
    full_name: { type: 'string', description: 'Candidate name, empty string if not present' },
    summary: { type: 'string', description: 'One or two sentence professional summary of the candidate' },
    skills: { type: 'array', items: { type: 'string' }, description: 'Technical and soft skills, deduplicated' },
    years_of_experience: { type: 'number', description: 'Total years of professional (non-education) experience, 0 if none' },
    education: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['institution', 'degree', 'field', 'year'],
        properties: {
          institution: { type: 'string' },
          degree: { type: 'string', description: 'e.g. BSc, MSc, Diploma; empty if unknown' },
          field: { type: 'string' },
          year: { type: 'string', description: 'Graduation year or range, empty if unknown' },
        },
      },
    },
    past_roles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'company', 'duration', 'highlights'],
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          duration: { type: 'string', description: 'e.g. "Jun 2022 – Aug 2023", empty if unknown' },
          highlights: { type: 'array', items: { type: 'string' }, description: 'Key achievements/responsibilities' },
        },
      },
    },
    certifications: { type: 'array', items: { type: 'string' } },
    github_url: { type: 'string', description: 'GitHub profile URL or username if present in the CV, empty string otherwise' },
  },
};

const SYSTEM = `You extract structured data from resumes/CVs for a job-matching app.
Be faithful to the document: never invent skills, employers, dates, or credentials that are not stated.
Include projects and internships in past_roles when they read like work experience.
Use empty strings, 0, or empty arrays for anything genuinely absent.`;

export async function parseCv(rawText) {
  const parsed = await generateJson({
    system: SYSTEM,
    prompt: `Extract the structured profile from this CV text:\n\n<cv>\n${rawText.slice(0, 60000)}\n</cv>`,
    schema: CV_SCHEMA,
  });

  // Normalize + dedupe so repeated CV lines (common in PDFs) do not appear twice in UI/scoring.
  parsed.skills = dedupeStrings(parsed.skills);
  parsed.certifications = dedupeStrings(parsed.certifications);
  parsed.education = dedupeEducation(parsed.education);
  parsed.past_roles = dedupeRoles(parsed.past_roles);
  parsed.full_name = String(parsed.full_name ?? '').trim();
  parsed.summary = String(parsed.summary ?? '').trim();
  parsed.github_url = String(parsed.github_url ?? '').trim();
  parsed.years_of_experience = Math.max(0, Number(parsed.years_of_experience) || 0);
  return parsed;
}

export function dedupeStrings(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values ?? []) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function dedupeEducation(items) {
  const out = [];
  const seen = new Set();
  for (const row of items ?? []) {
    const institution = String(row?.institution ?? '').trim();
    const degree = String(row?.degree ?? '').trim();
    const field = String(row?.field ?? '').trim();
    const year = String(row?.year ?? '').trim();
    if (!institution && !degree && !field && !year) continue;
    const key = `${institution.toLowerCase()}|${degree.toLowerCase()}|${field.toLowerCase()}|${year.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ institution, degree, field, year });
  }
  return out;
}

export function dedupeRoles(items) {
  const merged = new Map();
  for (const row of items ?? []) {
    const title = String(row?.title ?? '').trim();
    const company = String(row?.company ?? '').trim();
    const duration = String(row?.duration ?? '').trim();
    const highlights = dedupeStrings(row?.highlights ?? []);
    if (!title && !company && !duration && highlights.length === 0) continue;

    const key = `${title.toLowerCase()}|${company.toLowerCase()}|${duration.toLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { title, company, duration, highlights });
      continue;
    }
    existing.highlights = dedupeStrings([...existing.highlights, ...highlights]);
  }
  return [...merged.values()];
}
