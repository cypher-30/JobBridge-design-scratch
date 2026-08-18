import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import JobCard from '../components/JobCard.jsx';

const EMPTY_FILTERS = { q: '', location: '', remote: false, type: '', min_score: '', lane: 'verified' };

export default function JobsPage({ user, cvVersion }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ jobs: [], total: 0, hasCv: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [searches, setSearches] = useState([]);
  const [searchName, setSearchName] = useState('');

  useEffect(() => {
    if (!user) {
      setSearches([]);
      return;
    }
    api.searches().then(({ searches }) => setSearches(searches)).catch(() => {});
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = { page, sort };
      if (filters.q) params.q = filters.q;
      if (filters.location) params.location = filters.location;
      if (filters.remote) params.remote = '1';
      if (filters.type) params.type = filters.type;
      if (filters.min_score) params.min_score = filters.min_score;
      if (filters.lane && filters.lane !== 'all') params.lane = filters.lane;
      setData(await api.jobs(params));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters, sort, page]);

  useEffect(() => {
    load();
  }, [load, user, cvVersion]);

  function update(patch) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  async function analyzeTop() {
    const ids = data.jobs.filter((j) => j.match_score == null).slice(0, 8).map((j) => j.id);
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      await api.analyzeBatch(ids);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  async function saveCurrentSearch(e) {
    e.preventDefault();
    const name = searchName.trim();
    if (!name) return;
    try {
      const { search } = await api.saveSearch(name, filters);
      setSearches((s) => [search, ...s]);
      setSearchName('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeSearch(id) {
    await api.deleteSearch(id).catch(() => {});
    setSearches((s) => s.filter((x) => x.id !== id));
  }

  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 30)));

  return (
    <main>
      <div className="filters">
        <input
          className="search"
          placeholder="Search title, company, keywords…"
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
        />
        <input
          placeholder="Location"
          value={filters.location}
          onChange={(e) => update({ location: e.target.value })}
        />
        <select value={filters.type} onChange={(e) => update({ type: e.target.value })}>
          <option value="">All types</option>
          <option value="full-time">Full-time</option>
          <option value="internship">Internship</option>
          <option value="contract">Contract</option>
          <option value="other">Other</option>
        </select>
        <select value={filters.lane} onChange={(e) => update({ lane: e.target.value })}>
          <option value="verified">Verified lane</option>
          <option value="exploratory">Exploratory lane</option>
          <option value="all">All sources</option>
        </select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.remote}
            onChange={(e) => update({ remote: e.target.checked })}
          />
          Remote
        </label>
        {data.hasCv && (
          <>
            <select value={filters.min_score} onChange={(e) => update({ min_score: e.target.value })}>
              <option value="">Any match</option>
              <option value="50">50%+ match</option>
              <option value="70">70%+ match</option>
              <option value="85">85%+ match</option>
            </select>
            <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
              <option value="newest">Newest first</option>
              <option value="match">Best match first</option>
            </select>
            <button onClick={analyzeTop} disabled={bulkBusy}>
              {bulkBusy ? 'Analyzing…' : 'Analyze top results'}
            </button>
          </>
        )}
      </div>

      {user && (
        <div className="saved-searches">
          {searches.map((s) => (
            <span key={s.id} className="chip saved" title="Apply this search">
              <button
                className="chip-label"
                onClick={() => {
                  setFilters({ ...EMPTY_FILTERS, ...s.filters });
                  setPage(1);
                }}
              >
                {s.name}
              </button>
              <button className="chip-x" onClick={() => removeSearch(s.id)} aria-label={`Delete ${s.name}`}>
                ×
              </button>
            </span>
          ))}
          <form className="chip-add" onSubmit={saveCurrentSearch}>
            <input
              placeholder="Save current search as…"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
            />
          </form>
          <span className="hint-inline">Saved searches email you when new matching jobs are ingested.</span>
        </div>
      )}

      {!user && <div className="banner">Sign in with your email to upload a CV and see match scores.</div>}
      {user && !data.hasCv && (
        <div className="banner">Upload your CV in the “My CV” tab to unlock match scores and gap analysis.</div>
      )}
      {error && <div className="banner error">{error}</div>}

      {loading ? (
        <div className="empty">Loading jobs…</div>
      ) : data.jobs.length === 0 ? (
        <div className="empty">No jobs match these filters yet.</div>
      ) : (
        <>
          <div className="job-count">
            {data.total} job{data.total === 1 ? '' : 's'}
          </div>
          <div className="job-list">
            {data.jobs.map((job) => (
              <JobCard key={job.id} job={job} canAnalyze={data.hasCv} onAnalyzed={load} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="pager">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ← Prev
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
