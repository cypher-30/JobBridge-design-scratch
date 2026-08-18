// Single source of truth for the jobs Verified/Exploratory lane split.
// Previously this lived as two copy-pasted SQL CASE expressions in
// routes/jobs.js (one for the CV-matched SELECT, one for the unmatched one)
// plus a third hand-written predicate for the `lane=` filter — all three had
// to be kept in sync by hand. A new ATS source now only needs updating here.

export const VERIFIED_JOB_SOURCES = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'];

export const JOB_SOURCE_TRUST_SCORES = {
  greenhouse: 92,
  lever: 92,
  ashby: 88,
  smartrecruiters: 86,
  scraped: 52,
};

const DEFAULT_TRUST_SCORE = 40;

// SQL CASE expression (string) for `j.source` -> 'verified' | 'exploratory'.
export function jobLaneCaseSql(alias = 'j') {
  return `CASE WHEN ${alias}.source IN (${sqlList(VERIFIED_JOB_SOURCES)}) THEN 'verified' ELSE 'exploratory' END`;
}

// SQL CASE expression (string) for `j.source` -> numeric trust score.
export function jobTrustCaseSql(alias = 'j') {
  const branches = Object.entries(JOB_SOURCE_TRUST_SCORES)
    .map(([source, score]) => `WHEN ${alias}.source = '${source}' THEN ${score}`)
    .join(' ');
  return `CASE ${branches} ELSE ${DEFAULT_TRUST_SCORE} END`;
}

// WHERE-clause fragment (or null) for `lane=verified|exploratory`.
export function jobLaneWhereSql(lane, alias = 'j') {
  if (lane === 'verified') return `${alias}.source IN (${sqlList(VERIFIED_JOB_SOURCES)})`;
  if (lane === 'exploratory') return `${alias}.source NOT IN (${sqlList(VERIFIED_JOB_SOURCES)})`;
  return null;
}

function sqlList(values) {
  // Values are our own fixed source-name constants, never user input.
  return values.map((v) => `'${v}'`).join(', ');
}
