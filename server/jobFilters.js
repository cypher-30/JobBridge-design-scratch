// Shared WHERE-clause builder for job filters (q, location, remote, type).
// Used by the /api/jobs search route and the saved-search alert check so both
// interpret filters identically. Expects the jobs table aliased as `j`.
export function buildJobFilters(filters = {}) {
  const where = [];
  const params = [];

  const q = String(filters.q ?? '').trim();
  if (q) {
    where.push('(j.title LIKE ? OR j.company LIKE ? OR j.description LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const location = String(filters.location ?? '').trim();
  if (location) {
    where.push('j.location LIKE ?');
    params.push(`%${location}%`);
  }
  if (filters.remote === true || filters.remote === '1' || filters.remote === 'true') {
    where.push('j.remote = TRUE');
  }
  const type = String(filters.type ?? '').trim();
  if (['full-time', 'internship', 'contract', 'other'].includes(type)) {
    where.push('j.employment_type = ?');
    params.push(type);
  }
  return { where, params };
}
