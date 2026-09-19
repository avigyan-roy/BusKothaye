import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Header } from '../components/Header.js';
import { api, ApiError } from '../lib/api.js';
import {
  clearAccountSession,
  loadAccountSession,
  saveAccountSession,
} from '../lib/auth-session.js';
import './account-page.css';

/** Login-only entrance to the server-protected demo console. */
export function AdminLoginPage() {
  const navigate = useNavigate();
  const existing = loadAccountSession();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (existing?.account.isAdmin === true) {
    return <Navigate to="/demo" replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api.login(username, password);
      if (response.account.isAdmin !== true) {
        await api.logout(response.token).catch(() => undefined);
        throw new ApiError(403, 'FORBIDDEN', 'This account is not a demo administrator.');
      }
      clearAccountSession();
      saveAccountSession(response);
      navigate('/demo', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the API.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header action={{ label: 'Map', to: '/' }} />
      <main className="page account-page stack">
        <div>
          <p className="eyebrow">Restricted access</p>
          <h1>Demo administrator</h1>
          <p className="muted">
            Sign in with the server-configured administrator account to dispatch or change the
            simulated fleet.
          </p>
        </div>

        {import.meta.env.DEV ? (
          <p className="notice notice--quiet">
            Local default: username <strong>admin</strong>, password <strong>admin</strong>.
          </p>
        ) : null}
        {existing ? (
          <p className="notice notice--warning">
            You are signed in as {existing.account.username}. Administrator sign-in will replace
            that browser session.
          </p>
        ) : null}
        {error ? <p className="notice notice--danger">{error}</p> : null}

        <section className="panel account-page__panel stack">
          <form className="stack" onSubmit={submit}>
            <label className="field">
              <span className="field__label">Admin username</span>
              <input
                className="field__input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
                minLength={3}
              />
            </label>
            <PasswordField
              label="Admin password"
              value={password}
              onChange={setPassword}
              visible={showPassword}
              onVisibleChange={setShowPassword}
              autoComplete="current-password"
            />
            <button className="button" disabled={busy}>
              Open demo console
            </button>
          </form>
        </section>
      </main>
    </>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onVisibleChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  autoComplete: 'current-password' | 'new-password';
}) {
  return (
    <div className="stack account-page__password">
      <label className="field">
        <span className="field__label">{label}</span>
        <input
          className="field__input"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required
        />
      </label>
      <label className="account-page__show-password">
        <input
          type="checkbox"
          checked={visible}
          onChange={(event) => onVisibleChange(event.target.checked)}
        />
        Show password
      </label>
    </div>
  );
}
