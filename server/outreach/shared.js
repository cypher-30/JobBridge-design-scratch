// Shared helpers for outreach contacts. Previously `hydrate()` was defined
// twice (routes/outreach.js and reverify.js) and could silently drift, and
// `push`/`pushReason` (append-if-new-message) was copy-pasted between
// verification.js and discovery.js.

export function pushReason(reasons, message) {
  if (!reasons.includes(message)) reasons.push(message);
}

// Parses the JSON columns MySQL returns as strings back into arrays/objects.
export function hydrateOutreachContact(row) {
  return {
    ...row,
    tech_stack: parseJsonColumn(row.tech_stack, []),
    verification_reasons: parseJsonColumn(row.verification_reasons, []),
    priority_reasons: parseJsonColumn(row.priority_reasons, []),
  };
}

function parseJsonColumn(value, fallback) {
  if (typeof value === 'string') return JSON.parse(value);
  return value ?? fallback;
}

// Runs `worker` over `items` with at most `limit` in flight at once.
// Used by reverify.js so a nightly run of many contacts with dead links
// doesn't run fully sequentially (each with up to two 7s-timeout fetches)
// and block the HTTP handler that awaits it.
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runOne);
  await Promise.all(workers);
  return results;
}
