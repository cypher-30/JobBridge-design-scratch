import { generateJson } from './index.js';

// Fixed for this search cycle — update when the target window changes.
export const ATTACHMENT_WINDOW = 'January-April 2027';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body'],
  properties: {
    subject: { type: 'string', description: 'Short, specific subject line' },
    body: {
      type: 'string',
      description: 'Full email body as plain text, including greeting and sign-off, with \\n for line breaks',
    },
  },
};

const SYSTEM = `You draft a short, specific outreach email from a candidate to a company, requesting a 3-month internship/attachment. This is a DRAFT for the candidate to review and personally send — you are not sending anything.
- 120-180 words for the body. No generic filler like "I am a hardworking, passionate individual."
- Reference at least one concrete overlap between the candidate's skills/projects and the company's tech stack or sector.
- Use the "why this company" note as the actual reason for reaching out — do not invent a different reason.
- State clearly that the candidate is requesting a 3-month attachment/internship for the given window.
- Address the contact by name if provided, otherwise use a neutral greeting ("Hiring Team").
- Do not fabricate facts about the candidate or the company beyond what is given.
- Sign off with the candidate's name and email.`;

function candidateBlock(parsedCv, qualityScore) {
  const lines = [
    `Name: ${parsedCv.full_name || '(unknown)'}`,
    `Summary: ${parsedCv.summary || ''}`,
    `Top skills: ${(parsedCv.skills || []).join(', ')}`,
  ];
  const notable = (parsedCv.past_roles ?? []).slice(0, 3);
  if (notable.length) {
    lines.push('Notable experience:');
    for (const r of notable) lines.push(`- ${r.title} at ${r.company}: ${(r.highlights ?? []).join('; ')}`);
  }
  if (qualityScore?.key_strengths?.length) {
    lines.push(`Key strengths (from CV evaluation): ${qualityScore.key_strengths.join(', ')}`);
  }
  return lines.join('\n');
}

function companyBlock(contact) {
  const techStack = Array.isArray(contact.tech_stack) ? contact.tech_stack : JSON.parse(contact.tech_stack || '[]');
  return [
    `Name: ${contact.company_name}`,
    `Sector: ${contact.sector || '(unspecified)'}`,
    `Tech stack: ${techStack.join(', ') || '(unspecified)'}`,
    `Careers page: ${contact.careers_url || '(none)'}`,
    `Why this company fits this candidate: ${contact.why_fit || '(not specified — draft a general fit based on sector/tech stack overlap)'}`,
    `Contact name: ${contact.contact_name || '(unknown — use a neutral greeting)'}`,
  ].join('\n');
}

// contact: one row from outreach_contacts. qualityScore: optional result from
// server/llm/scoreCv.js, used to ground "key strengths" if available.
export async function draftOutreachEmail(parsedCv, contact, qualityScore) {
  const prompt = [
    '--- CANDIDATE ---',
    candidateBlock(parsedCv, qualityScore),
    '',
    '--- COMPANY ---',
    companyBlock(contact),
    '',
    `--- ATTACHMENT WINDOW ---\n${ATTACHMENT_WINDOW}`,
  ].join('\n');

  return generateJson({ system: SYSTEM, prompt, schema: SCHEMA });
}
