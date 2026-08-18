async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  me: () => request('/api/me'),
  login: (email) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  jobs: (params) => request(`/api/jobs?${new URLSearchParams(params)}`),
  getCv: () => request('/api/cv'),
  uploadCv: (file) => {
    const body = new FormData();
    body.append('file', file);
    return request('/api/cv', { method: 'POST', body });
  },
  saveCv: (parsed) => request('/api/cv', { method: 'PUT', body: JSON.stringify({ parsed }) }),
  getCvScore: (role) => request(`/api/cv/score?${new URLSearchParams(role ? { role } : {})}`),
  computeCvScore: (role) => request('/api/cv/score', { method: 'POST', body: JSON.stringify(role ? { role } : {}) }),
  analyze: (jobId) => request(`/api/jobs/${jobId}/analyze`, { method: 'POST' }),
  analyzeBatch: (jobIds) =>
    request('/api/jobs/analyze-batch', { method: 'POST', body: JSON.stringify({ job_ids: jobIds }) }),
  searches: () => request('/api/searches'),
  saveSearch: (name, filters) =>
    request('/api/searches', { method: 'POST', body: JSON.stringify({ name, filters }) }),
  deleteSearch: (id) => request(`/api/searches/${id}`, { method: 'DELETE' }),
  outreachMeta: () => request('/api/outreach/meta'),
  outreachContacts: ({ verificationStatus, status, verifiedAge, verifiedSort, followUp, sourcePreset, contactRole } = {}) =>
    request(
      `/api/outreach?${new URLSearchParams({
        ...(verificationStatus && verificationStatus !== 'all' ? { verification_status: verificationStatus } : {}),
        ...(status ? { status } : {}),
        ...(verifiedAge ? { verified_age: verifiedAge } : {}),
        ...(verifiedSort ? { verified_sort: verifiedSort } : {}),
        ...(followUp ? { follow_up: followUp } : {}),
        ...(sourcePreset ? { source_preset: sourcePreset } : {}),
        ...(contactRole ? { contact_role: contactRole } : {}),
      })}`,
    ),
  addOutreachContact: (contact) => request('/api/outreach', { method: 'POST', body: JSON.stringify(contact) }),
  updateOutreachContact: (id, patch) => request(`/api/outreach/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  reverifyOutreach: () => request('/api/outreach/reverify', { method: 'POST' }),
  createFollowup: (id, nextInDays = 7, markContacted = true) =>
    request(`/api/outreach/${id}/followup`, {
      method: 'POST',
      body: JSON.stringify({ next_in_days: nextInDays, mark_contacted: markContacted }),
    }),
  draftOutreach: (id) => request(`/api/outreach/${id}/draft`, { method: 'POST' }),
  setOutreachStatus: (id, status) =>
    request(`/api/outreach/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteOutreachContact: (id) => request(`/api/outreach/${id}`, { method: 'DELETE' }),
};
