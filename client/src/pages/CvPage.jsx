import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { scoreClass } from '../components/JobCard.jsx';

export default function CvPage({ user, onCvChanged }) {
  const [cv, setCv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    api
      .getCv()
      .then(({ cv }) => setCv(cv))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleFile(file) {
    if (!file) return;
    setUploading(true);
    setError('');
    setSaved(false);
    try {
      const { cv } = await api.uploadCv(file);
      setCv(cv);
      onCvChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function save(parsed) {
    setError('');
    try {
      const res = await api.saveCv(parsed);
      setCv(res.cv);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onCvChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) return <main><div className="banner">Sign in first to upload your CV.</div></main>;
  if (loading) return <main><div className="empty">Loading…</div></main>;

  return (
    <main>
      <section className="upload-box">
        <h2>{cv ? 'Replace your CV' : 'Upload your CV'}</h2>
        <p className="hint">PDF or DOCX, up to 10&nbsp;MB. We extract the text and structure it so we can match you against every job.</p>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => handleFile(e.target.files[0])}
          hidden
        />
        <button onClick={() => fileInput.current.click()} disabled={uploading}>
          {uploading ? 'Parsing your CV… (can take ~30s)' : 'Choose file'}
        </button>
        {cv && <span className="filename">Current: {cv.filename}</span>}
      </section>

      {error && <div className="banner error">{error}</div>}
      {saved && <div className="banner ok">Saved. Match scores will use your corrections.</div>}

      {cv?.parsed && <ParsedEditor key={cv.id} parsed={cv.parsed} onSave={save} />}
      {cv?.parsed && <CvQualityScore key={cv.id} />}
    </main>
  );
}

// Role-scoped CV quality score (GitHub-enrichment-aware rubric, independent of
// any specific job posting). Ported from hiring-agent's scoring; see
// server/llm/scoreCv.js.
function CvQualityScore() {
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState('');
  const [githubWarning, setGithubWarning] = useState('');

  useEffect(() => {
    api
      .getCvScore()
      .then(({ score }) => setScore(score))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function compute() {
    setComputing(true);
    setError('');
    setGithubWarning('');
    try {
      const { score, github_error } = await api.computeCvScore();
      setScore(score);
      if (github_error) setGithubWarning(`GitHub enrichment skipped: ${github_error}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setComputing(false);
    }
  }

  if (loading) return null;

  return (
    <section className="quality-score">
      <div className="parsed-head">
        <h2>CV quality score</h2>
        <button className="ghost" onClick={compute} disabled={computing}>
          {computing ? 'Scoring… (can take ~30s)' : score ? 'Recompute' : 'Compute score'}
        </button>
      </div>
      <p className="hint">
        Scored against the {score?.role ?? 'software_engineering_intern'} rubric (open source, self-built projects,
        production experience, technical skills) with GitHub signal when a profile URL is on your CV — not tied to
        any specific job posting.
      </p>
      {error && <div className="banner error">{error}</div>}
      {githubWarning && <div className="banner">{githubWarning}</div>}

      {score && (
        <div className="quality-body">
          <div className={`quality-total ${scoreClass((score.final_score / score.max_final_score) * 100)}`}>
            {score.final_score} / {score.max_final_score}
            {score.github_username && <span className="quality-gh">GitHub: @{score.github_username}</span>}
          </div>

          <div className="quality-categories">
            {Object.entries(score.scores).map(([key, cat]) => (
              <div key={key} className="quality-cat">
                <div className="quality-cat-head">
                  <span className="quality-cat-label">{key.replace(/_/g, ' ')}</span>
                  <span className="quality-cat-value">
                    {cat.score}/{cat.max}
                  </span>
                </div>
                <div className="quality-bar">
                  <div className="quality-bar-fill" style={{ width: `${(cat.score / cat.max) * 100}%` }} />
                </div>
                <p className="quality-evidence">{cat.evidence}</p>
              </div>
            ))}
          </div>

          <div className="skill-row">
            <h4>Bonus: +{score.bonus_points.total}</h4>
            <p className="quality-evidence">{score.bonus_points.breakdown}</p>
          </div>
          {score.deductions.total > 0 && (
            <div className="skill-row">
              <h4>Deductions: -{score.deductions.total}</h4>
              <p className="quality-evidence">{score.deductions.reasons}</p>
            </div>
          )}

          {score.key_strengths?.length > 0 && (
            <div className="skill-row">
              <h4>Key strengths</h4>
              <ul className="suggestions">
                {score.key_strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {score.areas_for_improvement?.length > 0 && (
            <div className="skill-row">
              <h4>Areas to improve</h4>
              <ul className="suggestions">
                {score.areas_for_improvement.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Shows what was extracted and lets the user correct mistakes before matching.
function ParsedEditor({ parsed, onSave }) {
  const [draft, setDraft] = useState(parsed);
  const [newSkill, setNewSkill] = useState('');
  const dirty = JSON.stringify(draft) !== JSON.stringify(parsed);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <section className="parsed">
      <div className="parsed-head">
        <h2>What we extracted</h2>
        {dirty && <button onClick={() => onSave(draft)}>Save corrections</button>}
      </div>

      <div className="field-grid">
        <label>
          Name
          <input value={draft.full_name ?? ''} onChange={(e) => set({ full_name: e.target.value })} />
        </label>
        <label>
          Years of experience
          <input
            type="number"
            min="0"
            step="0.5"
            value={draft.years_of_experience ?? 0}
            onChange={(e) => set({ years_of_experience: Number(e.target.value) })}
          />
        </label>
      </div>

      <label className="block">
        Summary
        <textarea rows={2} value={draft.summary ?? ''} onChange={(e) => set({ summary: e.target.value })} />
      </label>

      <div className="skill-row">
        <h4>Skills</h4>
        <div className="chips">
          {(draft.skills ?? []).map((s) => (
            <span key={s} className="chip have">
              {s}
              <button
                className="chip-x"
                onClick={() => set({ skills: draft.skills.filter((x) => x !== s) })}
                aria-label={`Remove ${s}`}
              >
                ×
              </button>
            </span>
          ))}
          <form
            className="chip-add"
            onSubmit={(e) => {
              e.preventDefault();
              const v = newSkill.trim();
              if (v && !draft.skills.includes(v)) set({ skills: [...draft.skills, v] });
              setNewSkill('');
            }}
          >
            <input placeholder="Add skill…" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} />
          </form>
        </div>
      </div>

      {(draft.past_roles ?? []).length > 0 && (
        <div className="skill-row">
          <h4>Experience</h4>
          {draft.past_roles.map((r, i) => (
            <div key={i} className="role">
              <div className="role-line">
                <input
                  value={r.title}
                  onChange={(e) => updateRole(i, { title: e.target.value })}
                  placeholder="Title"
                />
                <input
                  value={r.company}
                  onChange={(e) => updateRole(i, { company: e.target.value })}
                  placeholder="Company"
                />
                <input
                  value={r.duration}
                  onChange={(e) => updateRole(i, { duration: e.target.value })}
                  placeholder="Duration"
                  className="duration"
                />
              </div>
              {r.highlights?.length > 0 && (
                <ul className="highlights">
                  {r.highlights.map((h, j) => (
                    <li key={j}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {(draft.education ?? []).length > 0 && (
        <div className="skill-row">
          <h4>Education</h4>
          <ul>
            {draft.education.map((e, i) => (
              <li key={i}>
                {[e.degree, e.field].filter(Boolean).join(' in ')} — {e.institution}
                {e.year ? ` (${e.year})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(draft.certifications ?? []).length > 0 && (
        <div className="skill-row">
          <h4>Certifications</h4>
          <div className="chips">
            {draft.certifications.map((c) => (
              <span key={c} className="chip">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );

  function updateRole(i, patch) {
    setDraft((d) => ({
      ...d,
      past_roles: d.past_roles.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }));
  }
}
