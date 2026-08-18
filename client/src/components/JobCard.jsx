import MatchPanel from './MatchPanel.jsx';

const TYPE_LABELS = {
  'full-time': 'Full-time',
  internship: 'Internship',
  contract: 'Contract',
  other: 'Other',
};

export default function JobCard({ job, canAnalyze, onAnalyzed }) {
  const posted = job.posted_at ?? job.first_seen_at;
  return (
    <article className="job-card">
      <div className="job-main">
        <div className="job-head">
          <a href={job.url} target="_blank" rel="noreferrer" className="job-title">
            {job.title}
          </a>
          {job.match_score != null && (
            <span className={`score-badge ${scoreClass(job.match_score)}`}>{job.match_score}%</span>
          )}
        </div>
        <div className="job-meta">
          <strong>{job.company}</strong>
          {job.location && <span>· {job.location}</span>}
          {job.remote ? <span className="tag remote">Remote</span> : null}
          <span className={`tag type-${job.employment_type}`}>{TYPE_LABELS[job.employment_type]}</span>
          <span className={`tag source source-${job.source}`} title="Where this listing came from">
            {job.source}
          </span>
          {job.verification_lane && (
            <span className={`tag verification-${job.verification_lane}`}>{job.verification_lane}</span>
          )}
          {job.trust_score != null && <span className="tag trust-score">trust {job.trust_score}</span>}
          {posted && <span className="date">{new Date(posted).toLocaleDateString()}</span>}
        </div>
      </div>
      {canAnalyze && <MatchPanel job={job} onAnalyzed={onAnalyzed} />}
    </article>
  );
}

export function scoreClass(score) {
  if (score >= 85) return 'great';
  if (score >= 70) return 'good';
  if (score >= 50) return 'ok';
  return 'low';
}
