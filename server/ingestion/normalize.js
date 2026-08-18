import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

const MAX_DESCRIPTION_CHARS = 20000;

export function htmlToText(html) {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style').remove();
  return $.root()
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);
}

export function inferEmploymentType({ title = '', commitment = '' }) {
  const t = `${title} ${commitment}`.toLowerCase();
  // "Attachment", "graduate trainee", "apprentice"/"trainee" are the
  // standard Kenyan vocabulary for what other markets call an internship —
  // without these, postings using that wording fell through to 'full-time'
  // and the type=internship filter missed exactly the roles this tool
  // exists to find.
  if (/\bintern(ship)?\b|\battach(ment|ee)?\b|\bgraduate\s+trainee\b|\bapprentice(ship)?\b|\btrainee\b/.test(t)) {
    return 'internship';
  }
  if (/\bcontract(or)?\b|\bfreelance\b|\btemporary\b/.test(t)) return 'contract';
  if (/\bfull[ -]?time\b/.test(t) || commitment === '') return 'full-time';
  return 'other';
}

export function inferRemote({ location = '', workplaceType = '' }) {
  return /remote/i.test(location) || /remote/i.test(workplaceType);
}

export function dedupeKey(company, title, url) {
  return crypto.createHash('sha1').update(`${company}|${title}|${url}`).digest('hex');
}

// Every fetcher returns objects in this shape.
export function makeJob({ company, title, location, remote, employmentType, description, url, source, postedAt }) {
  return {
    company,
    title: (title || '').trim().slice(0, 512),
    location: location ? String(location).trim().slice(0, 255) : null,
    remote: Boolean(remote),
    employment_type: employmentType,
    description: description || null,
    url: String(url).slice(0, 1024),
    source,
    posted_at: postedAt ?? null,
    dedupe_key: dedupeKey(company, title, url),
  };
}
