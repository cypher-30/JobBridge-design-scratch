import { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUSES = ['not_contacted', 'drafted', 'sent', 'replied'];

// So the trust-score decay (see server/outreach/verification.js) is legible
// at a glance instead of requiring the reader to do date math against a
// locale timestamp.
function relativeAge(dateStr) {
  const then = new Date(dateStr);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((Date.now() - then.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export default function OutreachPage({ user }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [lane, setLane] = useState('verified');
  const [reverifyBusy, setReverifyBusy] = useState(false);
  const [reverifySummary, setReverifySummary] = useState(null);
  const [verifiedAge, setVerifiedAge] = useState('');
  const [verifiedSort, setVerifiedSort] = useState('trust');
  const [followUp, setFollowUp] = useState('');
  const [sourcePreset, setSourcePreset] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [meta, setMeta] = useState({ source_presets: [], contact_role_templates: [] });

  function reload() {
    setLoading(true);
    setError('');
    api
      .outreachContacts({ verificationStatus: lane, verifiedAge, verifiedSort, followUp, sourcePreset, contactRole })
      .then(({ contacts }) => setContacts(contacts))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (user) reload();
    else setLoading(false);
  }, [user, lane, verifiedAge, verifiedSort, followUp, sourcePreset, contactRole]);

  useEffect(() => {
    if (!user) return;
    api.outreachMeta().then(setMeta).catch(() => {});
  }, [user]);

  if (!user) return <main><div className="banner">Sign in first to build your outreach list.</div></main>;

  async function reverifyAll() {
    setReverifyBusy(true);
    setError('');
    try {
      const { summary } = await api.reverifyOutreach();
      setReverifySummary(summary);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setReverifyBusy(false);
    }
  }

  return (
    <main>
      <div className="outreach-head">
        <div>
          <h2>Outreach</h2>
          <p className="hint">
            Companies and startups to contact directly for a 3-month attachment. JobBridge drafts a personalized
            email per company — nothing is ever sent automatically. Review, edit, and send it yourself.
          </p>
        </div>
        <button className="ghost" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : 'Add company'}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}
      {reverifySummary && (
        <div className="banner">
          <div>
            Re-verified {reverifySummary.updated}/{reverifySummary.total} contacts. Verified: {reverifySummary.verified},
            exploratory: {reverifySummary.exploratory}, URL check failures: {reverifySummary.url_check_failures}.
          </div>
          {reverifySummary.failures?.length > 0 && (
            <ul className="reverify-failures">
              {reverifySummary.failures.map((f, i) => (
                <li key={`${f.company_name}-${i}`}>
                  <strong>{f.company_name}</strong>: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="lane-tabs" role="tablist" aria-label="Outreach lanes">
        <button
          className={`ghost ${lane === 'verified' ? 'active' : ''}`}
          onClick={() => setLane('verified')}
          role="tab"
          aria-selected={lane === 'verified'}
        >
          Verified lane
        </button>
        <button
          className={`ghost ${lane === 'exploratory' ? 'active' : ''}`}
          onClick={() => setLane('exploratory')}
          role="tab"
          aria-selected={lane === 'exploratory'}
        >
          Exploratory lane
        </button>
        <button
          className={`ghost ${lane === 'all' ? 'active' : ''}`}
          onClick={() => setLane('all')}
          role="tab"
          aria-selected={lane === 'all'}
        >
          All
        </button>
        <button className="ghost" onClick={reverifyAll} disabled={reverifyBusy}>
          {reverifyBusy ? 'Re-verifying…' : 'Re-verify all links'}
        </button>
      </div>

      <div className="filters">
        <select value={verifiedAge} onChange={(e) => setVerifiedAge(e.target.value)}>
          <option value="">Any verification age</option>
          <option value="recent14">Verified in last 14 days</option>
          <option value="recent30">Verified in last 30 days</option>
          <option value="stale30">Stale or unverified (30+ days)</option>
          <option value="never">Never live-verified</option>
        </select>
        <select value={verifiedSort} onChange={(e) => setVerifiedSort(e.target.value)}>
          <option value="trust">Sort by trust score</option>
          <option value="newest">Sort by latest verification</option>
          <option value="oldest">Sort by oldest verification</option>
        </select>
        <select value={followUp} onChange={(e) => setFollowUp(e.target.value)}>
          <option value="">Any follow-up state</option>
          <option value="due">Follow-up due now</option>
          <option value="upcoming">Follow-up scheduled</option>
          <option value="none">No follow-up set</option>
        </select>
        <select value={sourcePreset} onChange={(e) => setSourcePreset(e.target.value)}>
          <option value="">All discovery sources</option>
          {meta.source_presets.map((s) => (
            <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>
          ))}
        </select>
        <select value={contactRole} onChange={(e) => setContactRole(e.target.value)}>
          <option value="">All contact roles</option>
          {meta.contact_role_templates.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {showAdd && (
        <AddContactForm
          sourcePresets={meta.source_presets}
          roleTemplates={meta.contact_role_templates}
          onAdded={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : contacts.length === 0 ? (
        <div className="empty">
          {lane === 'verified'
            ? 'No verified companies yet. Add one with a live ATS/careers source to raise trust.'
            : lane === 'exploratory'
              ? 'No exploratory companies yet. Add lower-confidence leads here for later verification.'
              : 'No companies yet. Add one to get started.'}
        </div>
      ) : (
        <div className="job-list">
          {contacts.map((c) => (
            <ContactCard key={c.id} contact={c} onChanged={reload} />
          ))}
        </div>
      )}
    </main>
  );
}

function AddContactForm({ onAdded, sourcePresets, roleTemplates }) {
  const [form, setForm] = useState({
    company_name: '',
    sector: '',
    location: '',
    careers_url: '',
    contact_name: '',
    contact_email: '',
    source: '',
    source_preset: '',
    contact_role: '',
    notes: '',
    tech_stack: '',
    why_fit: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    if (!form.company_name.trim()) return setError('Company name is required');
    setSaving(true);
    setError('');
    try {
      await api.addOutreachContact({
        ...form,
        tech_stack: form.tech_stack.split(',').map((s) => s.trim()).filter(Boolean),
      });
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="upload-box outreach-form" onSubmit={submit}>
      <div className="field-grid">
        <label>
          Company name
          <input value={form.company_name} onChange={(e) => set({ company_name: e.target.value })} required />
        </label>
        <label>
          Sector
          <input value={form.sector} onChange={(e) => set({ sector: e.target.value })} placeholder="fintech" />
        </label>
        <label>
          Location
          <input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="Nairobi, Kenya" />
        </label>
        <label>
          Careers URL
          <input value={form.careers_url} onChange={(e) => set({ careers_url: e.target.value })} />
        </label>
        <label>
          Contact name
          <input value={form.contact_name} onChange={(e) => set({ contact_name: e.target.value })} />
        </label>
        <label>
          Contact email
          <input value={form.contact_email} onChange={(e) => set({ contact_email: e.target.value })} />
        </label>
        <label>
          Tech stack (comma-separated)
          <input value={form.tech_stack} onChange={(e) => set({ tech_stack: e.target.value })} placeholder="Python, Django" />
        </label>
        <label>
          Source
          <input value={form.source} onChange={(e) => set({ source: e.target.value })} placeholder="LinkedIn, referral…" />
        </label>
        <label>
          Discovery source
          <select value={form.source_preset} onChange={(e) => set({ source_preset: e.target.value })}>
            <option value="">Pick source preset</option>
            {(sourcePresets ?? []).map((s) => (
              <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>
            ))}
          </select>
        </label>
        <label>
          Contact role
          <select value={form.contact_role} onChange={(e) => set({ contact_role: e.target.value })}>
            <option value="">Pick role template</option>
            {(roleTemplates ?? []).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        Why this company fits you
        <textarea
          rows={2}
          value={form.why_fit}
          onChange={(e) => set({ why_fit: e.target.value })}
          placeholder="The concrete reason to reach out — used as the actual grounding for the drafted email"
        />
      </label>
      <label className="block">
        Notes
        <textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      {error && <div className="banner error">{error}</div>}
      <button type="submit" disabled={saving}>
        {saving ? 'Adding…' : 'Add company'}
      </button>
    </form>
  );
}

function ContactCard({ contact, onChanged }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState(contact.draft_subject ?? '');
  const [body, setBody] = useState(contact.draft_body ?? '');
  const [copied, setCopied] = useState(false);
  const [nextDays, setNextDays] = useState('7');

  useEffect(() => {
    setSubject(contact.draft_subject ?? '');
    setBody(contact.draft_body ?? '');
  }, [contact.draft_subject, contact.draft_body]);

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const { contact: updated } = await api.draftOutreach(contact.id);
      setSubject(updated.draft_subject ?? '');
      setBody(updated.draft_body ?? '');
      setOpen(true);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    setBusy(true);
    setError('');
    try {
      await api.updateOutreachContact(contact.id, { draft_subject: subject, draft_body: body });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status) {
    try {
      await api.setOutreachStatus(contact.id, status);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${contact.company_name} from your outreach list?`)) return;
    await api.deleteOutreachContact(contact.id);
    onChanged();
  }

  async function scheduleFollowup() {
    setBusy(true);
    setError('');
    try {
      await api.createFollowup(contact.id, Number(nextDays), true);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    navigator.clipboard?.writeText(`Subject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="job-card">
      <div className="job-head">
        <strong className="job-title">{contact.company_name}</strong>
        <div className="contact-tags">
          <span className={`tag verification-${contact.verification_status}`}>
            {contact.verification_status}
          </span>
          <span className="tag trust-score">trust {contact.trust_score ?? 0}</span>
          <span className={`tag status-${contact.status}`}>{contact.status.replace('_', ' ')}</span>
        </div>
      </div>
      <div className="job-meta">
        {contact.sector && <span>{contact.sector}</span>}
        {contact.location && <span>· {contact.location}</span>}
        {contact.contact_role && <span>· {contact.contact_role}</span>}
        {contact.source_preset && <span className="tag">{contact.source_preset.replaceAll('_', ' ')}</span>}
        {contact.tech_stack?.length > 0 && (
          <div className="chips">
            {contact.tech_stack.map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
          </div>
        )}
      </div>
      {contact.why_fit && <p className="quality-evidence">{contact.why_fit}</p>}
      <p className="quality-evidence">
        Priority score: {contact.priority_score ?? 0}
        {contact.priority_reasons?.length > 0 ? ` • ${contact.priority_reasons.join(' • ')}` : ''}
      </p>
      {contact.verification_reasons?.length > 0 && (
        <p className="quality-evidence">Why this lane: {contact.verification_reasons.join(' • ')}</p>
      )}
      {contact.last_verified_at && (
        <p className="quality-evidence">
          Last live verification: {relativeAge(contact.last_verified_at)} ({new Date(contact.last_verified_at).toLocaleDateString()})
        </p>
      )}
      {contact.last_contacted_at && (
        <p className="quality-evidence">Last contacted: {new Date(contact.last_contacted_at).toLocaleString()}</p>
      )}
      {contact.next_follow_up_at && (
        <p className="quality-evidence">Next follow-up: {new Date(contact.next_follow_up_at).toLocaleString()}</p>
      )}
      {contact.last_verification_error && (
        <p className="quality-evidence">Latest verification issue: {contact.last_verification_error}</p>
      )}

      <div className="match-panel">
        <div className="outreach-actions">
          <button className="ghost" onClick={generate} disabled={busy}>
            {busy ? 'Working…' : contact.draft_body ? 'Regenerate draft' : 'Generate draft'}
          </button>
          {body && (
            <button className="ghost" onClick={() => setOpen(!open)}>
              {open ? 'Hide draft' : 'Show draft'}
            </button>
          )}
          <select value={contact.status} onChange={(e) => changeStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
          <select
            value={contact.response_state || 'none'}
            onChange={(e) => api.updateOutreachContact(contact.id, { response_state: e.target.value }).then(onChanged).catch((err) => setError(err.message))}
          >
            <option value="none">response: none</option>
            <option value="interested">response: interested</option>
            <option value="not_now">response: not now</option>
            <option value="rejected">response: rejected</option>
            <option value="referred">response: referred</option>
          </select>
          <select value={nextDays} onChange={(e) => setNextDays(e.target.value)}>
            <option value="3">follow-up in 3d</option>
            <option value="7">follow-up in 7d</option>
            <option value="14">follow-up in 14d</option>
            <option value="21">follow-up in 21d</option>
          </select>
          <button className="ghost" onClick={scheduleFollowup} disabled={busy}>Set follow-up</button>
          <button className="ghost" onClick={remove}>Remove</button>
        </div>
        {error && <div className="match-error">{error}</div>}

        {open && body && (
          <div className="match-details">
            <label className="block">
              Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className="block">
              Body
              <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            </label>
            <div className="outreach-actions">
              <button onClick={saveEdit} disabled={busy}>Save edits</button>
              <button className="ghost" onClick={copy}>{copied ? 'Copied!' : 'Copy to clipboard'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
