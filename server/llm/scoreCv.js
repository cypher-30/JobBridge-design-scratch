// Role-scoped CV quality scoring — ported from hiring-agent's evaluator.py
// (HackerRank's open-sourced resume scorer). Unlike matchJob.js (fit to one
// specific posting), this scores the CV itself against a role's rubric
// (server/roles/<role>/role.json), enriched with GitHub signal when available.
import { generateJson } from './index.js';
import { loadRole } from '../roles/index.js';

function buildScoreSchema(role) {
  const scoreProps = {};
  for (const c of role.categories) {
    scoreProps[c.key] = {
      type: 'object',
      additionalProperties: false,
      required: ['score', 'max', 'evidence'],
      properties: {
        score: { type: 'integer', description: `0-${c.max}, must never exceed ${c.max}` },
        max: { type: 'integer', description: `always ${c.max}` },
        evidence: { type: 'string', description: 'Specific evidence from the CV/GitHub data backing this score, non-empty' },
      },
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['scores', 'bonus_points', 'deductions', 'key_strengths', 'areas_for_improvement'],
    properties: {
      scores: {
        type: 'object',
        additionalProperties: false,
        required: role.categories.map((c) => c.key),
        properties: scoreProps,
      },
      bonus_points: {
        type: 'object',
        additionalProperties: false,
        required: ['total', 'breakdown'],
        properties: {
          total: { type: 'integer', description: `0-${role.bonusMax}` },
          breakdown: { type: 'string' },
        },
      },
      deductions: {
        type: 'object',
        additionalProperties: false,
        required: ['total', 'reasons'],
        properties: {
          total: { type: 'integer', description: 'Non-negative magnitude of points deducted' },
          reasons: { type: 'string' },
        },
      },
      key_strengths: { type: 'array', items: { type: 'string' }, description: '1-5 items' },
      areas_for_improvement: { type: 'array', items: { type: 'string' }, description: '1-3 items' },
    },
  };
}

function candidateText(parsedCv) {
  const lines = [
    `Name: ${parsedCv.full_name || '(not stated)'}`,
    `Summary: ${parsedCv.summary || ''}`,
    `Years of experience: ${parsedCv.years_of_experience ?? 0}`,
    `Skills: ${(parsedCv.skills || []).join(', ') || '(none listed)'}`,
    `GitHub/portfolio URL in profile: ${parsedCv.github_url || '(none listed)'}`,
    '',
    'Work / internship / volunteer experience:',
    ...(parsedCv.past_roles ?? []).map(
      (r) => `- ${r.title} at ${r.company} (${r.duration})${r.highlights?.length ? `: ${r.highlights.join('; ')}` : ''}`,
    ),
    (parsedCv.past_roles ?? []).length === 0 ? '(none listed)' : '',
    '',
    'Education:',
    ...(parsedCv.education ?? []).map((e) => `- ${e.degree} in ${e.field}, ${e.institution} (${e.year})`),
    (parsedCv.education ?? []).length === 0 ? '(none listed)' : '',
    '',
    `Certifications: ${(parsedCv.certifications ?? []).join(', ') || '(none listed)'}`,
  ];
  return lines.join('\n');
}

function githubBlockText(enrichment) {
  if (!enrichment) return null;
  return JSON.stringify({ profile: enrichment.profile, projects: enrichment.projects }, null, 2);
}

// enrichment is the (optional) result of server/github/enrich.js's enrichFromGithub.
export async function scoreCv(parsedCv, roleName, enrichment) {
  const role = await loadRole(roleName);
  const schema = buildScoreSchema(role);
  const prompt = role.buildCriteria(candidateText(parsedCv), githubBlockText(enrichment));

  const result = await generateJson({ system: role.systemMessage, prompt, schema });

  // The schema expects deductions.total as a non-negative magnitude; some
  // models still emit it negative (mirrors evaluator.py's own guard for this).
  result.deductions.total = Math.abs(Number(result.deductions.total) || 0);
  result.bonus_points.total = Math.max(0, Math.min(role.bonusMax, Number(result.bonus_points.total) || 0));

  for (const c of role.categories) {
    const cat = result.scores[c.key];
    cat.score = Math.max(0, Math.min(c.max, Number(cat.score) || 0));
    cat.max = c.max;
  }

  const categorySum = role.categories.reduce((sum, c) => sum + result.scores[c.key].score, 0);
  const finalScore = Math.max(
    role.minFinalScore,
    Math.min(role.maxFinalScore, categorySum + result.bonus_points.total - result.deductions.total),
  );

  return {
    role: roleName,
    scores: result.scores,
    bonus_points: result.bonus_points,
    deductions: result.deductions,
    key_strengths: result.key_strengths,
    areas_for_improvement: result.areas_for_improvement,
    final_score: finalScore,
    max_final_score: role.maxFinalScore,
    github_username: enrichment?.profile?.username ?? null,
  };
}
