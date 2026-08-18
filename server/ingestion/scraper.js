import * as cheerio from 'cheerio';
import { inferEmploymentType, inferRemote, makeJob } from './normalize.js';

// Best-effort generic career-page scraper. Two modes:
//  1. Config selectors: { job_list_item, title, link, date_posted } from companies.json
//  2. Heuristic fallback: anchors whose href looks like a job posting link
// Scraped listings are inherently lower-confidence — callers mark source: 'scraped'
// and per-company failures are isolated in ingestion/index.js.
export async function fetchScraped(companyName, { careers_url: careersUrl, selectors }) {
  const res = await fetch(careersUrl, {
    headers: { 'User-Agent': 'JobBridgeBot/1.0 (+job aggregator; contact: admin@localhost)' },
  });
  if (!res.ok) throw new Error(`Scrape ${careersUrl}: HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const found = selectors?.job_list_item
    ? scrapeWithSelectors($, careersUrl, selectors)
    : scrapeHeuristically($, careersUrl);

  const seen = new Set();
  const jobs = [];
  for (const { title, url, postedAt, location } of found) {
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    jobs.push(
      makeJob({
        company: companyName,
        title,
        location: location ?? null,
        remote: inferRemote({ location: location ?? '' }) || /remote/i.test(title),
        employmentType: inferEmploymentType({ title }),
        description: null, // listing pages rarely carry full descriptions; left null on purpose
        url,
        source: 'scraped',
        postedAt: postedAt ?? null,
      }),
    );
  }
  return jobs;
}

function scrapeWithSelectors($, baseUrl, sel) {
  const out = [];
  $(sel.job_list_item).each((_, el) => {
    const item = $(el);
    const title = sel.title ? item.find(sel.title).first().text().trim() : item.text().trim();
    const linkEl = sel.link ? item.find(sel.link).first() : item.find('a').first();
    const href = linkEl.attr('href') ?? (item.is('a') ? item.attr('href') : null);
    const dateText = sel.date_posted ? item.find(sel.date_posted).first().text().trim() : '';
    const postedAt = dateText && !Number.isNaN(Date.parse(dateText)) ? new Date(dateText) : null;
    const location = sel.location ? item.find(sel.location).first().text().trim() : null;
    if (href) out.push({ title, url: new URL(href, baseUrl).href, postedAt, location });
  });
  return out;
}

const JOB_HREF = /\/(jobs?|careers?|positions?|openings?|vacanc|opportunit)[/-]/i;
const NOISE_TITLE = /^(careers?|jobs?|apply|learn more|view|see all|open positions?)$/i;

function scrapeHeuristically($, baseUrl) {
  const out = [];
  $('a[href]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href');
    const title = a.text().replace(/\s+/g, ' ').trim();
    if (!href || !JOB_HREF.test(href)) return;
    if (title.length < 5 || title.length > 120 || NOISE_TITLE.test(title)) return;
    out.push({ title, url: new URL(href, baseUrl).href });
  });
  return out;
}
