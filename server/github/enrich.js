// GitHub signal enrichment — ported from hiring-agent's github.py (HackerRank's
// open-sourced resume scorer). Fetches a candidate's public GitHub profile and
// repos, classifies each repo as 'open_source' (multiple contributors) vs
// 'self_project' (single contributor), and asks the LLM to pick the top 7 most
// impressive ones for CV-quality scoring (server/llm/scoreCv.js).
//
// Deliberately does NOT port the original's "sleep until rate limit resets"
// behavior (up to 1 hour) — that would hang an HTTP request. Instead this
// surfaces a clear error pointing at GITHUB_TOKEN.
import { config } from '../config.js';
import { generateJson } from '../llm/index.js';

const GITHUB_API = 'https://api.github.com';
const MAX_REPOS = 100;
const TOP_PROJECT_COUNT = 7;
const MIN_AUTHOR_COMMITS = 4;

function authHeaders() {
  const headers = { Accept: 'application/vnd.github+json' };
  if (config.githubToken) headers.Authorization = `token ${config.githubToken}`;
  return headers;
}

async function githubGet(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    throw new Error(
      'GitHub API rate limit hit. Set GITHUB_TOKEN in .env to raise the limit from 60/hour to 5000/hour.',
    );
  }
  return { status: res.status, data: res.status === 200 ? await res.json() : null };
}

export function extractGithubUsername(githubUrl) {
  if (!githubUrl) return null;
  const url = githubUrl.replace(/\s/g, '').trim();
  const patterns = [/https?:\/\/github\.com\/([^/]+)/, /github\.com\/([^/]+)/, /@([^/]+)/, /^([a-zA-Z0-9-]+)$/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1].split('?')[0];
  }
  return null;
}

async function fetchProfile(username) {
  const { status, data } = await githubGet(`${GITHUB_API}/users/${username}`);
  if (status !== 200) return null;
  return {
    username,
    name: data.name,
    bio: data.bio,
    location: data.location,
    company: data.company,
    public_repos: data.public_repos,
    followers: data.followers,
    blog: data.blog,
    hireable: data.hireable,
  };
}

async function fetchRepoContributors(owner, repo) {
  const { status, data } = await githubGet(`${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=100`);
  return status === 200 && Array.isArray(data) ? data : [];
}

function tallyContributions(owner, contributors) {
  let authorCommits = 0;
  let totalCommits = 0;
  for (const c of contributors) {
    const contributions = c.contributions ?? 0;
    totalCommits += contributions;
    if ((c.login ?? '').toLowerCase() === owner.toLowerCase()) authorCommits = contributions;
  }
  return { authorCommits, totalCommits };
}

async function fetchAllRepos(username) {
  const { status, data } = await githubGet(
    `${GITHUB_API}/users/${username}/repos?sort=updated&per_page=${MAX_REPOS}&type=all`,
  );
  if (status === 404) throw new Error(`GitHub user not found: ${username}`);
  if (status !== 200) return [];

  const repos = data.filter((r) => !(r.fork && (r.forks_count ?? 0) < 5));

  // Contributor lookups are one request per repo — bound concurrency so a
  // candidate with many repos doesn't blow through the rate limit at once.
  const projects = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < repos.length; i += CONCURRENCY) {
    const batch = repos.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (repo) => {
        const contributors = await fetchRepoContributors(username, repo.name);
        const { authorCommits, totalCommits } = tallyContributions(username, contributors);
        return {
          name: repo.name,
          description: repo.description,
          github_url: repo.html_url,
          live_url: repo.homepage || null,
          technologies: repo.language ? [repo.language] : [],
          project_type: contributors.length > 1 ? 'open_source' : 'self_project',
          contributor_count: contributors.length,
          author_commit_count: authorCommits,
          total_commit_count: totalCommits,
          stars: repo.stargazers_count ?? 0,
          forks: repo.forks_count ?? 0,
        };
      }),
    );
    projects.push(...results);
  }

  return projects.sort((a, b) => b.stars - a.stars);
}

function selectionSystem(positionTitle) {
  return `You are an expert technical recruiter analyzing GitHub repositories to identify the most impressive projects for a ${positionTitle}.
ABSOLUTE REQUIREMENT: only select projects where author_commit_count is 4 or higher — 1-3 commits indicates minimal involvement and must never be selected.
Prioritize, in order: (1) high author_commit_count (15+ is substantial, 5-14 is meaningful), (2) contributions to popular open source projects (1000+ stars) even if the contribution is small, (3) technical complexity and real-world impact, (4) code quality and community engagement.
Avoid: tutorial/classroom projects, projects with 1-3 author commits, stale projects with no real activity.`;
}

const SELECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['selected'],
  properties: {
    selected: {
      type: 'array',
      description: `Up to ${TOP_PROJECT_COUNT} unique project names (must match "name" from the input list exactly), ordered best first. Fewer than ${TOP_PROJECT_COUNT} if fewer qualify.`,
      items: { type: 'string' },
    },
  },
};

async function selectTopProjects(projects, positionTitle) {
  const qualifying = projects.filter((p) => p.author_commit_count >= MIN_AUTHOR_COMMITS);
  if (!qualifying.length) return [];

  try {
    const result = await generateJson({
      system: selectionSystem(positionTitle),
      prompt: `Select the top ${TOP_PROJECT_COUNT} projects from this list:\n\n${JSON.stringify(qualifying, null, 2)}`,
      schema: SELECTION_SCHEMA,
    });
    const byName = new Map(qualifying.map((p) => [p.name, p]));
    const chosen = [];
    const seen = new Set();
    for (const name of result.selected ?? []) {
      const project = byName.get(name);
      if (project && !seen.has(name)) {
        chosen.push(project);
        seen.add(name);
      }
    }
    if (chosen.length) return chosen.slice(0, TOP_PROJECT_COUNT);
  } catch (err) {
    console.warn(`[github/enrich] LLM project selection failed, falling back to top-by-stars: ${err.message}`);
  }
  return qualifying.slice(0, TOP_PROJECT_COUNT);
}

// Extracts a username from resume text/URL, fetches profile + repos, and
// returns { profile, projects } (projects already narrowed to the top ones).
// Returns null if no GitHub username can be resolved or the profile 404s.
export async function enrichFromGithub(githubUrlOrUsername, positionTitle = 'software engineering position') {
  const username = extractGithubUsername(githubUrlOrUsername);
  if (!username) return null;

  const profile = await fetchProfile(username);
  if (!profile) return null;

  const allProjects = await fetchAllRepos(username);
  const projects = await selectTopProjects(allProjects, positionTitle);

  return { profile, projects, total_repos_seen: allProjects.length };
}
