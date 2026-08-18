import { generateJson } from './index.js';

const MATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'summary', 'matching_skills', 'missing_skills', 'suggestions'],
  properties: {
    score: {
      type: 'integer',
      description: 'Match percentage 0-100. 90+: near-perfect fit. 70-89: strong fit with small gaps. 50-69: partial fit. <50: significant gaps.',
    },
    summary: { type: 'string', description: 'Two or three plain-language sentences on overall fit, written to the candidate ("you")' },
    matching_skills: { type: 'array', items: { type: 'string' }, description: 'Skills/experience from the CV that this job asks for' },
    missing_skills: { type: 'array', items: { type: 'string' }, description: 'Skills/keywords the job asks for that the CV lacks or under-emphasizes' },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete, actionable improvements, e.g. "Highlight your X project near the top" or "Add a certification in Y". 3-6 items.',
    },
  },
};

const SYSTEM = `You are a career advisor scoring how well a candidate's CV matches one specific job posting.
Be honest and calibrated — do not inflate scores. Judge seniority fit too (an internship posting matches a student better than a 10-year veteran and vice versa).
Speak directly to the candidate ("you"). Suggestions must be concrete and doable this week, not generic advice.`;

export async function matchJob(parsedCv, job) {
  const result = await generateJson({
    system: SYSTEM,
    prompt: [
      `<candidate_profile>\n${JSON.stringify(parsedCv, null, 2)}\n</candidate_profile>`,
      `<job>\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location ?? 'unspecified'}\nType: ${job.employment_type}\n\n${job.description || '(no full description available — judge from the title and company)'}\n</job>`,
      'Score this candidate against this job and produce the gap analysis.',
    ].join('\n\n'),
    schema: MATCH_SCHEMA,
  });
  result.score = Math.min(100, Math.max(0, Math.round(Number(result.score) || 0)));
  return result;
}
