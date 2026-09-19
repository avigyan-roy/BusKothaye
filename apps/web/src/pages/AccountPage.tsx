import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AccountRole } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import { api, ApiError } from '../lib/api.js';
import {
  clearAccountSession,
  loadAccountSession,
  saveAccountSession,
  type AccountSession,
} from '../lib/auth-session.js';
import { en } from '../content/en.js';
import './account-page.css';

export function AccountPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const entry = params.get('entry') === 'crew' ? 'crew' : 'passenger';
  const [session, setSession] = useState<AccountSession | null>(() => loadAccountSession());
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AccountRole>(entry === 'crew' ? 'driver' : 'passenger');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response =
        mode === 'register'
          ? await api.register(username, password, role)
          : await api.login(username, password);
      const next = saveAccountSession(response);
      setSession(next);
      if (response.account.isAdmin === true) navigate('/demo');
      else if (entry === 'crew') navigate('/drive');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  const chooseRole = async (nextRole: AccountRole) => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setSession(saveAccountSession(await api.selectRole(session.token, nextRole)));
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setSession(
        saveAccountSession(
          await api.changePassword(session.token, currentPassword, newPassword),
        ),
      );
      setCurrentPassword('');
      setNewPassword('');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (session) await api.logout(session.token).catch(() => undefined);
    clearAccountSession();
    setSession(null);
  };

  return (
    <>
      <Header action={{ label: en.header.passengerLink, to: '/' }} />
      <main className="page account-page stack">
        <div>
          <p className="eyebrow">{entry === 'crew' ? en.account.crewEntry : en.account.passengerEntry}</p>
          <h1>{session ? en.account.yourAccount : en.account.title}</h1>
          <p className="muted">{en.account.honesty}</p>
        </div>

        {error ? <p className="notice notice--danger">{error}</p> : null}

        {!session ? (
          <section className="panel account-page__panel stack">
            <div className="account-page__tabs" role="tablist" aria-label={en.account.title}>
              <button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => setMode('login')}>
                {en.account.login}
              </button>
              <button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => setMode('register')}>
                {en.account.register}
              </button>
            </div>
            <form className="stack" onSubmit={submit}>
              <label className="field">
                <span className="field__label">{en.account.username}</span>
                <input className="field__input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} />
              </label>
              <label className="field">
                <span className="field__label">{en.account.password}</span>
                <input className="field__input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 10 : 1} />
              </label>
              {mode === 'register' ? <RolePicker value={role} onChange={setRole} /> : null}
              <button className="button" disabled={busy}>{mode === 'register' ? en.account.create : en.account.login}</button>
            </form>
            <p className="meta">
              Demo controls use a separate <Link to="/admin">administrator sign-in</Link>.
            </p>
          </section>
        ) : (
          <>
            <section className="panel account-page__panel stack">
              <p><strong>{session.account.username}</strong></p>
              <p className="muted">
                {session.account.isAdmin === true
                  ? en.account.administrator
                  : `${en.account.role}: ${en.account.roles[session.account.role]}`}
              </p>
              {session.account.isAdmin === true ? null : (
                <RolePicker value={session.account.role} onChange={(next) => void chooseRole(next)} disabled={busy} />
              )}
              <div className="drive__actions">
                {session.account.isAdmin === true ? (
                  <button type="button" className="button" onClick={() => navigate('/demo')}>{en.account.openDemo}</button>
                ) : (
                  <button type="button" className="button" onClick={() => navigate('/drive')}>{en.account.openCrew}</button>
                )}
                <button type="button" className="button button--secondary" onClick={() => void logout()}>{en.account.logout}</button>
              </div>
            </section>
            <section className="panel account-page__panel stack">
              <h2>{en.account.changePassword}</h2>
              <form className="stack" onSubmit={changePassword}>
                <label className="field"><span className="field__label">{en.account.currentPassword}</span><input className="field__input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
                <label className="field"><span className="field__label">{en.account.newPassword}</span><input className="field__input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={10} required /></label>
                <button className="button button--secondary" disabled={busy}>{en.account.changePassword}</button>
              </form>
              <p className="meta">{en.account.recovery}</p>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function RolePicker({ value, onChange, disabled = false }: { value: AccountRole; onChange: (role: AccountRole) => void; disabled?: boolean }) {
  return (
    <fieldset className="account-page__roles">
      <legend className="field__label">{en.account.chooseRole}</legend>
      {(['passenger', 'driver', 'conductor'] as const).map((candidate) => (
        <label key={candidate}>
          <input type="radio" name="account-role" checked={value === candidate} disabled={disabled} onChange={() => onChange(candidate)} />{' '}
          {en.account.roles[candidate]}
        </label>
      ))}
    </fieldset>
  );
}

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : en.errors.offline;
}
