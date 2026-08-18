import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computePriority } from '../outreach/discovery.js';

describe('computePriority', () => {
  test('verified + trust + Kenya + attachment-friendly stacks up', () => {
    const r = computePriority({
      verification_status: 'verified',
      trust_score: 90,
      location: 'Nairobi, Kenya',
      accepts_attachments: 'true',
      contact_role: 'HR Manager',
      source_preset: 'direct_referral',
      contact_email: 'hr@company.com',
    });
    assert.ok(r.priority_score > 80, `expected a high score, got ${r.priority_score}`);
    assert.ok(r.priority_reasons.length > 0);
  });

  test('bare exploratory contact with no signals scores near the floor', () => {
    const r = computePriority({});
    assert.equal(r.priority_score, 20);
  });

  test('score is clamped to [0, 100]', () => {
    const r = computePriority({
      verification_status: 'verified',
      trust_score: 100,
      location: 'Nairobi, Kenya',
      accepts_attachments: 'true',
      contact_role: 'HR Manager',
      source_preset: 'direct_referral',
      contact_email: 'hr@company.com',
      next_follow_up_at: new Date(Date.now() - 1000),
    });
    assert.ok(r.priority_score <= 100);
  });

  test('a due follow-up adds urgency', () => {
    const withoutDue = computePriority({});
    const withDue = computePriority({ next_follow_up_at: new Date(Date.now() - 1000) });
    assert.ok(withDue.priority_score > withoutDue.priority_score);
  });
});
