import { useEffect, useState } from 'react';
import { api } from './api.js';
import JobsPage from './pages/JobsPage.jsx';
import CvPage from './pages/CvPage.jsx';
import OutreachPage from './pages/OutreachPage.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState('jobs');
  const [email, setEmail] = useState('');
  const [loginError, setLoginError] = useState('');
  const [cvVersion, setCvVersion] = useState(0); // bump to make JobsPage refetch after CV changes

  useEffect(() => {
    api.me().then(({ user }) => setUser(user)).finally(() => setChecked(true));
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError('');
    try {
      const { user } = await api.login(email);
      setUser(user);
      setEmail('');
    } catch (err) {
      setLoginError(err.message);
    }
  }

  async function handleLogout() {
    await api.logout();
    setUser(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setTab('jobs')}>
          Job<span>Bridge</span>
        </div>
        <nav>
          <button className={tab === 'jobs' ? 'active' : ''} onClick={() => setTab('jobs')}>
            Jobs
          </button>
          <button className={tab === 'cv' ? 'active' : ''} onClick={() => setTab('cv')}>
            My CV
          </button>
          <button className={tab === 'outreach' ? 'active' : ''} onClick={() => setTab('outreach')}>
            Outreach
          </button>
        </nav>
        <div className="auth">
          {user ? (
            <>
              <span className="email">{user.email}</span>
              <button className="ghost" onClick={handleLogout}>
                Sign out
              </button>
            </>
          ) : (
            <form onSubmit={handleLogin} className="login-form">
              <input
                type="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button type="submit">Sign in</button>
            </form>
          )}
        </div>
      </header>
      {loginError && <div className="banner error">{loginError}</div>}

      {checked && tab === 'jobs' && <JobsPage user={user} cvVersion={cvVersion} />}
      {checked && tab === 'cv' && <CvPage user={user} onCvChanged={() => setCvVersion((v) => v + 1)} />}
      {checked && tab === 'outreach' && <OutreachPage user={user} />}
    </div>
  );
}
