import { useState } from 'react';
import { api } from '../api.js';
import { scoreClass } from './JobCard.jsx';

// Inline per-listing match analysis. If the jobs list already carries a cached
// analysis, show it immediately; otherwise offer the Analyze button.
export default function MatchPanel({ job, onAnalyzed }) {
  const cached =
    job.match_score != null
      ? {
          score: job.match_score,
          summary: job.match_summary,
          matching_skills: job.matching_skills ?? [],
          missing_skills: job.missing_skills ?? [],
          suggestions: job.suggestions ?? [],
        }
      : null;

  const [analysis, setAnalysis] = useState(cached);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setBusy(true);
    setError('');
    try {
      const { analysis } = await api.analyze(job.id);
      setAnalysis(analysis);
      setOpen(true);
      onAnalyzed?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!analysis) {
    return (
      <div className="match-panel">
        <button className="ghost" onClick={run} disabled={busy}>
          {busy ? 'Analyzing…' : 'Analyze match'}
        </button>
        {error && <div className="match-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="match-panel">
      <button className="ghost" onClick={() => setOpen(!open)}>
        {open ? 'Hide analysis' : `Match details (${analysis.score}%)`}
      </button>
      {open && (
        <div className="match-details">
          <div className={`match-summary ${scoreClass(analysis.score)}`}>{analysis.summary}</div>
          {analysis.matching_skills?.length > 0 && (
            <div className="skill-row">
              <h4>You already have</h4>
              <div className="chips">
                {analysis.matching_skills.map((s) => (
                  <span key={s} className="chip have">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {analysis.missing_skills?.length > 0 && (
            <div className="skill-row">
              <h4>Missing or under-emphasized</h4>
              <div className="chips">
                {analysis.missing_skills.map((s) => (
                  <span key={s} className="chip miss">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {analysis.suggestions?.length > 0 && (
            <div className="skill-row">
              <h4>How to improve your odds</h4>
              <ul className="suggestions">
                {analysis.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
