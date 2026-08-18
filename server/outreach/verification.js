import dns from 'node:dns/promises';
import net from 'node:net';
import { pushReason as push } from './shared.js';

// Companies/ATS providers whose careers board we treat as inherently trustworthy
// (a live posting there is strong evidence on its own).
const TRUSTED_ATS_HOSTS = [
  'boards.greenhouse.io',
  'boards-api.greenhouse.io',
  'job-boards.eu.greenhouse.io',
  'jobs.lever.co',
  'api.lever.co',
  'jobs.ashbyhq.com',
  'jobs.smartrecruiters.com',
  'api.smartrecruiters.com',
  'workdayjobs.com',
  'myworkdayjobs.com',
  'freshteam.com',
  'breezy.hr',
  'smartrecruiters.com',
];

// Free text can only ever push a contact DOWN to Exploratory, never up to
// Verified — self-attestation ("notes says 'verified'") is not evidence.
// See computeVerification for how this is applied.
const NEGATIVE_PATTERNS = [
  /search\s+only/i,
  /search\s+snippet/i,
  /lower\s+confidence/i,
  /unverified/i,
  /not\s+independently\s+fetched/i,
  /could\s+not\s+independently\s+confirm/i,
  /http\s*403/i,
];

function cleanStr(v) {
  return String(v ?? '').trim();
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isTrustedHost(host) {
  return Boolean(host && TRUSTED_ATS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)));
}

function hasRealContactEmail(email) {
  const value = cleanStr(email).toLowerCase();
  if (!value || !value.includes('@')) return false;
  return !/@(example\.com|example\.org|example\.net)$/i.test(value);
}

// How much of the "was live-verified" credit survives, keyed by age bucket.
// 'expired' (or never verified) means the credit is withdrawn entirely —
// the contact falls back to the "has URL but not verified" tier.
function freshnessOf(lastVerifiedAt) {
  if (!lastVerifiedAt) return { bucket: 'never', ageDays: null };
  const verifiedAt = new Date(lastVerifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) return { bucket: 'never', ageDays: null };
  const ageDays = Math.floor((Date.now() - verifiedAt.getTime()) / (24 * 60 * 60 * 1000));
  if (ageDays <= 14) return { bucket: 'fresh', ageDays };
  if (ageDays <= 30) return { bucket: 'aging', ageDays };
  if (ageDays <= 60) return { bucket: 'stale', ageDays };
  return { bucket: 'expired', ageDays };
}

const DECAY_PENALTY = { fresh: 0, aging: 8, stale: 18 };

// Single source of truth for verification scoring. Reads only stored fields —
// no network calls here. computeVerificationWithReliability (below) is the
// only caller that does a live check; it does so BEFORE calling this, then
// scores against the post-check state, so a just-passed check is never
// scored against its own stale timestamp.
//
// Tiers (evidence-based, highest applicable wins):
//   A (85) trusted ATS host + live-verified within 60 days (decays 0/-8/-18 by age)
//   B (72) own domain, live-verified within 60 days (same decay)
//   C (60) trusted ATS host, never verified or verification expired (>60d)
//   D (45) has a careers URL, never verified or verification expired
//   E (20) no careers URL
// A failed live check demotes below the "never checked" tier for that same
// host type — a known-dead link is worse evidence than an untested one.
export function computeVerification(contact) {
  const reasons = [];
  const source = cleanStr(contact.source);
  const notes = cleanStr(contact.notes);
  const location = cleanStr(contact.location).toLowerCase();
  const careersUrl = cleanStr(contact.careers_url);
  const host = hostFromUrl(careersUrl);
  const trustedHost = isTrustedHost(host);
  const hasUrl = Boolean(careersUrl);
  const linkIsBroken = Boolean(contact.last_verification_error);
  const fresh = freshnessOf(contact.last_verified_at);
  const hasLiveCredit = !linkIsBroken && fresh.bucket !== 'never' && fresh.bucket !== 'expired';

  let score;
  if (linkIsBroken) {
    score = trustedHost ? 50 : 15;
    push(
      reasons,
      trustedHost
        ? 'Live URL check failed on an otherwise trusted ATS host — needs manual re-check.'
        : 'Live URL check failed; treated as unverified until it resolves again.',
    );
  } else if (!hasUrl) {
    score = 20;
    push(reasons, 'No careers URL to verify.');
  } else if (trustedHost) {
    if (hasLiveCredit) {
      score = 85 - (DECAY_PENALTY[fresh.bucket] ?? 0);
      push(reasons, `Trusted ATS host (${host}), live-verified ${fresh.ageDays} day(s) ago.`);
    } else {
      score = 60;
      push(
        reasons,
        contact.last_verified_at
          ? 'Trusted ATS host, but the last live verification is more than 60 days old.'
          : 'Trusted ATS host, not yet live-verified.',
      );
    }
  } else if (hasLiveCredit) {
    score = 72 - (DECAY_PENALTY[fresh.bucket] ?? 0);
    push(reasons, `Own careers domain, live-verified ${fresh.ageDays} day(s) ago.`);
  } else {
    score = 45;
    push(
      reasons,
      contact.last_verified_at
        ? 'Live verification is more than 60 days old — treated as unverified until re-checked.'
        : 'Has a careers URL but has never been live-verified.',
    );
  }

  if (location.includes('nairobi') || location.includes('kenya')) {
    score += 6;
    push(reasons, 'Location explicitly references Kenya/Nairobi.');
  }
  if (hasRealContactEmail(contact.contact_email)) {
    score += 5;
    push(reasons, 'Has a non-placeholder contact email.');
  }
  if (contact.accepts_attachments === 'true') {
    score += 5;
    push(reasons, 'Explicitly marked as accepting attachments/interns.');
  }
  const sourcePreset = cleanStr(contact.source_preset).toLowerCase();
  if (['ats_board', 'official_careers_page', 'direct_referral'].includes(sourcePreset)) {
    score += 4;
    push(reasons, 'High-signal discovery source.');
  }

  // Demotions below are hard caps to Exploratory, not subtractions — a
  // subtraction can still leave a high base (e.g. trusted-host tier at 85)
  // above the 70 threshold, which defeats the point of the demotion.
  let forceExploratory = false;
  if (NEGATIVE_PATTERNS.some((p) => p.test(source)) || NEGATIVE_PATTERNS.some((p) => p.test(notes))) {
    push(reasons, 'Source/notes include low-confidence signals — capped below Verified.');
    forceExploratory = true;
  }
  if (contact.is_example) {
    push(reasons, 'Example placeholder contact — never treated as Verified.');
    forceExploratory = true;
    score = Math.min(score, 40);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const verification_status = !forceExploratory && score >= 70 ? 'verified' : 'exploratory';

  if (!reasons.length) push(reasons, 'Default exploratory classification due to limited evidence.');

  return { verification_status, trust_score: score, verification_reasons: reasons };
}

// Exposed so callers doing many contacts at once (reverify.js) can fetch a
// URL shared by multiple contacts once and reuse the result, instead of
// each contact re-fetching the same page.
export async function liveCheckUrl(url, timeoutMs = 7000) {
  return checkCareersUrl(url, timeoutMs);
}

// Live-checks the careers URL (or reuses `precomputedCheck` — see
// liveCheckUrl above), then scores against the POST-check state (fixes the
// bug where a just-passed check was scored against its own old, stale
// last_verified_at and understated its own result).
export async function computeVerificationWithReliability(
  contact,
  { timeoutMs = 7000, precomputedCheck } = {},
) {
  const url = cleanStr(contact.careers_url);
  let lastVerifiedAt = contact.last_verified_at ?? null;
  let lastVerificationError = null;

  if (!url) {
    lastVerificationError = 'Missing careers URL';
  } else {
    const check = precomputedCheck ?? (await checkCareersUrl(url, timeoutMs));
    if (check.ok) {
      lastVerifiedAt = new Date();
      lastVerificationError = null;
    } else {
      lastVerificationError = check.error;
      // lastVerifiedAt intentionally left as whatever the last SUCCESSFUL
      // check produced (or null) — a failed check doesn't get credit.
    }
  }

  const verification = computeVerification({
    ...contact,
    last_verified_at: lastVerifiedAt,
    last_verification_error: lastVerificationError,
  });

  return {
    ...verification,
    last_verified_at: lastVerifiedAt,
    last_verification_error: lastVerificationError,
  };
}

// ---- SSRF-safe URL check --------------------------------------------------
// checkCareersUrl fetches an arbitrary user-supplied URL from the server, on
// a nightly unattended cron across every user's contacts. Without guarding
// this, it's a blind SSRF port-scanner: careers_url could be
// http://127.0.0.1:3306 or http://169.254.169.254/latest/meta-data/.
// Guards: http(s) only, DNS-resolve and reject private/loopback/link-local/
// CGNAT addresses (re-checked on every redirect hop, manually followed and
// bounded), and the response body is always drained/cancelled so sockets
// aren't leaked across a run of many contacts.

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 2_000_000;
const USER_AGENT = 'JobBridgeBot/1.0 (+careers-url verification; contact: admin@localhost)';

function isPrivateIp(ip) {
  const type = net.isIP(ip);
  if (type === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 127) return true; // "this network" / loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata 169.254.169.254
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80:')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.split(':').pop();
      if (net.isIPv4(v4)) return isPrivateIp(v4);
    }
    return false;
  }
  return true; // couldn't classify — block rather than risk it
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Target resolves to a private/internal address');
    return;
  }
  let addrs;
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error('DNS resolution failed');
  }
  if (!addrs.length) throw new Error('DNS resolution failed');
  for (const { address } of addrs) {
    if (isPrivateIp(address)) throw new Error('Target resolves to a private/internal address');
  }
}

async function drainAndClose(res) {
  if (!res.body) return;
  try {
    const reader = res.body.getReader();
    let received = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value?.length ?? 0;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } catch {
    // response already errored/aborted — nothing left to drain
  }
}

async function fetchOnceGuarded(urlStr, method, timeoutMs) {
  const u = new URL(urlStr);
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error(`Blocked scheme: ${u.protocol}`);
  }
  await assertPublicHost(u.hostname);
  return fetch(urlStr, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': USER_AGENT },
  });
}

// Follows redirects itself (rather than trusting fetch's automatic
// follower) so every hop gets the same scheme + private-IP validation.
async function followGuarded(urlStr, method, timeoutMs) {
  let current = urlStr;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const res = await fetchOnceGuarded(current, method, timeoutMs);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await drainAndClose(res);
      if (!location) return res;
      current = new URL(location, current).href;
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

async function checkCareersUrl(url, timeoutMs) {
  try {
    const head = await followGuarded(url, 'HEAD', timeoutMs);
    if (head.ok) {
      await drainAndClose(head);
      return { ok: true };
    }
    const headStatus = head.status;
    await drainAndClose(head);
    if (![403, 405, 501].includes(headStatus)) {
      return { ok: false, error: `HTTP ${headStatus}` };
    }

    const get = await followGuarded(url, 'GET', timeoutMs);
    const getOk = get.ok;
    const getStatus = get.status;
    await drainAndClose(get);
    return getOk ? { ok: true } : { ok: false, error: `HTTP ${getStatus}` };
  } catch (err) {
    return { ok: false, error: err?.message || 'network error' };
  }
}
