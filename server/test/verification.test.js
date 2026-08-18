import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeVerification, computeVerificationWithReliability } from '../outreach/verification.js';

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('computeVerification tiers', () => {
  test('Tier A: trusted ATS host, live-verified fresh -> verified, high score', () => {
    const r = computeVerification({
      careers_url: 'https://boards.greenhouse.io/moniepoint',
      last_verified_at: daysAgo(0),
    });
    assert.equal(r.verification_status, 'verified');
    assert.equal(r.trust_score, 85);
  });

  test('Tier B: own domain, live-verified fresh + Kenya -> verified', () => {
    const r = computeVerification({
      careers_url: 'https://careers.example-kenya.com',
      location: 'Nairobi, Kenya',
      last_verified_at: daysAgo(0),
    });
    assert.equal(r.verification_status, 'verified');
    assert.equal(r.trust_score, 78); // 72 base + 6 kenya
  });

  test('Tier B alone (no Kenya bonus) sits right at the 70 threshold', () => {
    const r = computeVerification({
      careers_url: 'https://careers.example.com',
      last_verified_at: daysAgo(0),
    });
    assert.equal(r.trust_score, 72);
    assert.equal(r.verification_status, 'verified');
  });

  test('Tier C: trusted ATS host, never verified -> exploratory', () => {
    const r = computeVerification({ careers_url: 'https://boards.greenhouse.io/moniepoint' });
    assert.equal(r.trust_score, 60);
    assert.equal(r.verification_status, 'exploratory');
  });

  test('Tier D: has URL, never verified, own domain -> exploratory even with Kenya', () => {
    const r = computeVerification({
      careers_url: 'https://careers.example-kenya.com',
      location: 'Nairobi, Kenya',
    });
    assert.equal(r.trust_score, 51); // 45 + 6
    assert.equal(r.verification_status, 'exploratory');
  });

  test('Tier E: no careers URL -> exploratory, floor score', () => {
    const r = computeVerification({});
    assert.equal(r.trust_score, 20);
    assert.equal(r.verification_status, 'exploratory');
  });

  test('a real Kenyan own-domain company, live-checked, is reachable as Verified — the core fix', () => {
    // This is the scenario that was previously stuck at ~54 under the old
    // additive model even after a passing live check.
    const r = computeVerification({
      careers_url: 'https://careers.moniepoint.example',
      location: 'Nairobi, Kenya',
      contact_email: 'hr@moniepoint.example',
      accepts_attachments: 'true',
      last_verified_at: daysAgo(1),
    });
    assert.equal(r.verification_status, 'verified');
    assert.ok(r.trust_score >= 70, `expected >=70, got ${r.trust_score}`);
  });
});

describe('freshness decay boundaries', () => {
  test('14 days: full credit, still Tier A score', () => {
    const r = computeVerification({ careers_url: 'https://boards.greenhouse.io/x', last_verified_at: daysAgo(14) });
    assert.equal(r.trust_score, 85);
  });

  test('15 days: enters aging bucket, -8', () => {
    const r = computeVerification({ careers_url: 'https://boards.greenhouse.io/x', last_verified_at: daysAgo(15) });
    assert.equal(r.trust_score, 77);
  });

  test('30 days: still aging, -8', () => {
    const r = computeVerification({ careers_url: 'https://boards.greenhouse.io/x', last_verified_at: daysAgo(30) });
    assert.equal(r.trust_score, 77);
  });

  test('31 days: enters stale bucket, -18', () => {
    const r = computeVerification({ careers_url: 'https://boards.greenhouse.io/x', last_verified_at: daysAgo(31) });
    assert.equal(r.trust_score, 67);
  });

  test('60 days: still stale, -18', () => {
    const r = computeVerification({ careers_url: 'https://boards.greenhouse.io/x', last_verified_at: daysAgo(60) });
    assert.equal(r.trust_score, 67);
  });

  test('61 days: expired, live-check credit withdrawn entirely -> drops to Tier C', () => {
    const r = computeVerification({ careers_url: 'https://boards.greenhouse.io/x', last_verified_at: daysAgo(61) });
    assert.equal(r.trust_score, 60);
    assert.equal(r.verification_status, 'exploratory');
  });

  test('expired own-domain contact drops from Tier B to Tier D', () => {
    const r = computeVerification({ careers_url: 'https://careers.example.com', last_verified_at: daysAgo(65) });
    assert.equal(r.trust_score, 45);
  });
});

describe('self-attestation cannot promote, only demote', () => {
  test('notes claiming "Verified 2026-08" without a live check does NOT reach Verified', () => {
    const r = computeVerification({
      notes: 'Verified 2026-08 — confirmed live job board',
      location: 'Nairobi, Kenya',
    });
    assert.equal(r.verification_status, 'exploratory');
    assert.ok(r.trust_score < 70, `expected <70, got ${r.trust_score}`);
  });

  test('negative-pattern notes cap an otherwise-passing contact at Exploratory', () => {
    const r = computeVerification({
      careers_url: 'https://boards.greenhouse.io/x',
      last_verified_at: daysAgo(0),
      notes: 'search snippet only, could not independently confirm',
    });
    assert.equal(r.verification_status, 'exploratory');
  });
});

describe('is_example is a hard demotion, not a subtraction', () => {
  test('an example contact on a trusted, freshly-verified ATS host still cannot reach Verified', () => {
    // Regression check: base 85 - a flat 15 would still clear the 70
    // threshold. is_example must force Exploratory regardless of score.
    const r = computeVerification({
      careers_url: 'https://boards.greenhouse.io/x',
      last_verified_at: daysAgo(0),
      is_example: true,
    });
    assert.equal(r.verification_status, 'exploratory');
  });
});

describe('broken live link demotes below "never checked"', () => {
  test('trusted host with a failed check scores below the same host never-checked', () => {
    const neverChecked = computeVerification({ careers_url: 'https://boards.greenhouse.io/x' });
    const broken = computeVerification({
      careers_url: 'https://boards.greenhouse.io/x',
      last_verification_error: 'HTTP 404',
    });
    assert.ok(broken.trust_score < neverChecked.trust_score);
    assert.equal(broken.verification_status, 'exploratory');
  });
});

describe('computeVerificationWithReliability scores against the POST-check state', () => {
  test('a successful check is scored fresh, not against its own stale timestamp', async () => {
    // Regression for the "stale-then-refreshed" bug: previously the score
    // was computed BEFORE last_verified_at was updated to "now", so a
    // just-passed check on a contact that hadn't been checked in 65 days
    // still carried the >60-day penalty on the very run that fixed it.
    const contact = {
      careers_url: 'https://boards.greenhouse.io/x',
      last_verified_at: daysAgo(65),
    };
    const result = await computeVerificationWithReliability(contact, {
      precomputedCheck: { ok: true },
    });
    assert.equal(result.trust_score, 85, 'should score as freshly verified (Tier A), not stale');
    assert.equal(result.verification_status, 'verified');
    assert.ok(result.last_verified_at instanceof Date);
  });

  test('a failed check does not advance last_verified_at and records the error', async () => {
    const contact = { careers_url: 'https://careers.example.com', last_verified_at: null };
    const result = await computeVerificationWithReliability(contact, {
      precomputedCheck: { ok: false, error: 'HTTP 404' },
    });
    assert.equal(result.last_verified_at, null);
    assert.equal(result.last_verification_error, 'HTTP 404');
    assert.equal(result.verification_status, 'exploratory');
  });

  test('missing careers_url short-circuits without attempting a check', async () => {
    const result = await computeVerificationWithReliability({});
    assert.equal(result.last_verification_error, 'Missing careers URL');
  });
});
