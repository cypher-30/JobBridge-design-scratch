import { pushReason } from './shared.js';

export const SOURCE_PRESETS = [
  'vc_portfolio',
  'accelerator_incubator',
  'official_careers_page',
  'ats_board',
  'linkedin_company_page',
  'community_referral',
  'demo_day_event',
  'direct_referral',
  'other',
];

export const CONTACT_ROLE_TEMPLATES = [
  'HR Manager',
  'Talent Acquisition',
  'People Operations',
  'Engineering Manager',
  'CTO / Head of Engineering',
  'Founder / Co-founder',
  'Other',
];

function hasEmail(v) {
  const s = String(v ?? '').trim();
  return Boolean(s && s.includes('@'));
}

export function computePriority(contact) {
  let score = 20;
  const reasons = [];
  const location = String(contact.location ?? '').toLowerCase();
  const role = String(contact.contact_role ?? '').toLowerCase();
  const sourcePreset = String(contact.source_preset ?? '').toLowerCase();
  const verificationStatus = String(contact.verification_status ?? 'exploratory');
  const trust = Number(contact.trust_score ?? 0);

  if (verificationStatus === 'verified') {
    score += 25;
    pushReason(reasons, 'Verified source lane.');
  }

  score += Math.round(trust * 0.3);
  pushReason(reasons, `Trust contributes ${Math.round(trust * 0.3)} points.`);

  if (/nairobi|kenya/.test(location)) {
    score += 18;
    pushReason(reasons, 'Kenya/Nairobi location relevance.');
  }

  if (contact.accepts_attachments === 'true') {
    score += 12;
    pushReason(reasons, 'Explicitly attachment-friendly.');
  }

  if (/hr|talent|people/.test(role)) {
    score += 10;
    pushReason(reasons, 'Direct recruiting contact role.');
  } else if (/engineering manager|cto|head of engineering|founder/.test(role)) {
    score += 9;
    pushReason(reasons, 'Decision-maker contact role.');
  }

  if (['vc_portfolio', 'accelerator_incubator', 'direct_referral'].includes(sourcePreset)) {
    score += 8;
    pushReason(reasons, 'High-signal discovery source.');
  }

  if (hasEmail(contact.contact_email)) {
    score += 8;
    pushReason(reasons, 'Has direct contact email.');
  }

  if (contact.next_follow_up_at) {
    const due = new Date(contact.next_follow_up_at);
    if (!Number.isNaN(due.getTime()) && due.getTime() <= Date.now()) {
      score += 6;
      pushReason(reasons, 'Follow-up is due now.');
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { priority_score: score, priority_reasons: reasons };
}
