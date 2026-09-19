import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import type { DemoControlDto, DemoFleetConfig } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import { RouteSwitcher } from '../features/journeys/RouteSwitcher.js';
import { useRoute } from '../hooks/useRoute.js';
import { useRoutes } from '../hooks/useRoutes.js';
import { api, ApiError } from '../lib/api.js';
import {
  clearAccountSession,
  loadAccountSession,
  type AccountSession,
} from '../lib/auth-session.js';
import './demo-console-page.css';

export function DemoConsolePage() {
  const [account, setAccount] = useState<AccountSession | null>(() => loadAccountSession());
  const [needsFreshLogin, setNeedsFreshLogin] = useState(false);
  const { routes, error: routesError } = useRoutes();
  const [control, setControl] = useState<DemoControlDto | null>(null);
  const [draft, setDraft] = useState<DemoFleetConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { route } = useRoute(draft?.routeId ?? 'ac24-patuli-howrah');

  const refresh = useCallback(async () => {
    if (account?.account.isAdmin !== true) return;
    try {
      const next = await api.getDemoControl(account.token);
      setControl(next);
      setDraft((current) => current ?? next.config);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        // Memory-mode restarts invalidate server sessions while sessionStorage
        // survives in the open tab. Drop the stale local admin marker so the
        // login page does not immediately redirect back into an auth loop.
        clearAccountSession();
        setAccount(null);
        setNeedsFreshLogin(true);
        return;
      }
      setError(messageFor(caught));
    }
  }, [account]);

  useEffect(() => {
    void refresh();
    if (account?.account.isAdmin !== true) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [account, refresh]);

  const act = async (operation: () => Promise<DemoControlDto>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await operation();
      setControl(next);
      setDraft(next.config);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  if (account?.account.isAdmin !== true) {
    return <Navigate to={needsFreshLogin ? '/admin?reason=session' : '/admin'} replace />;
  }

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!account || !draft) return;
    void act(() => api.updateDemo(account.token, draft));
  };

  return (
    <>
      <Header action={{ label: 'Map', to: '/' }} />
      <main className="page demo-console stack">
        <div>
          <h1>Demo fleet</h1>
          <p className="muted">
            This switch controls the shared simulated fleet for everyone using this deployment.
            Simulated journeys remain visibly marked Demo.
          </p>
        </div>

        {error ? <p className="notice notice--danger">{error}</p> : null}

        {control && draft ? (
          <>
            <section className="panel demo-console__summary stack">
              <div>
                <span className={`demo-console__state demo-console__state--${control.status.toLowerCase()}`}>
                  {control.status}
                </span>
                <strong>{control.activeJourneyCount} active demo buses</strong>
              </div>
              <p className="meta">
                Generation {control.generation} · last changed {new Date(control.updatedAtMs).toLocaleString()}
              </p>
              <div className="drive__actions">
                {control.status === 'OFF' ? (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => void act(() => api.switchDemo(account.token, true, draft))}
                  >
                    Dispatch demo fleet
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={busy}
                    onClick={() => void act(() => api.switchDemo(account.token, false))}
                  >
                    End demo fleet
                  </button>
                )}
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() => void act(() => api.resetDemo(account.token))}
                >
                  Reset fleet
                </button>
              </div>
            </section>

            <form className="panel stack" onSubmit={save}>
              <h2>Dispatch settings</h2>
              <p className="muted">
                Choose a route corridor, where the fleet enters it, and where this run ends.
                Speeds are capped at 50 km/h.
              </p>
              {routesError ? <p className="notice notice--warning">The route directory could not be loaded.</p> : null}
              <RouteSwitcher
                routes={routes}
                currentRouteId={draft.routeId}
                compact
                onSelect={(routeId) => setDraft({ ...draft, routeId, startStopId: null, endStopId: null })}
              />

              <label className="field">
                <span className="field__label">Starting checkpoint</span>
                <select
                  className="field__input"
                  value={draft.startStopId ?? ''}
                  onChange={(event) => {
                    const startStopId = event.target.value || null;
                    setDraft({ ...draft, startStopId, endStopId: null });
                  }}
                >
                  <option value="">Route origin</option>
                  {route?.dto.stops.map((stop) => (
                    <option key={stop.id} value={stop.id}>{stop.name}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">Destination checkpoint</span>
                <select
                  className="field__input"
                  value={draft.endStopId ?? ''}
                  onChange={(event) => setDraft({ ...draft, endStopId: event.target.value || null })}
                >
                  <option value="">Route destination</option>
                  {route?.dto.stops
                    .filter((_, index) => {
                      const startIndex = draft.startStopId === null
                        ? -1
                        : route.dto.stops.findIndex((stop) => stop.id === draft.startStopId);
                      return index > startIndex;
                    })
                    .map((stop) => (
                      <option key={stop.id} value={stop.id}>{stop.name}</option>
                    ))}
                </select>
              </label>

              <div className="demo-console__grid">
                <NumberField label="Buses" value={draft.busCount} min={1} max={10} onChange={(busCount) => setDraft({ ...draft, busCount })} />
                <NumberField label="Sources per bus" value={draft.sourcesPerBus} min={1} max={5} onChange={(sourcesPerBus) => setDraft({ ...draft, sourcesPerBus })} />
                <NumberField label="Cruise speed (km/h)" value={draft.speedKmh} min={5} max={50} step={1} onChange={(speedKmh) => setDraft({ ...draft, speedKmh })} />
                <NumberField label="Update interval (ms)" value={draft.cadenceMs} min={3000} max={60000} step={1000} onChange={(cadenceMs) => setDraft({ ...draft, cadenceMs })} />
                <NumberField label="GPS noise (m)" value={draft.noiseM} min={0} max={100} step={1} onChange={(noiseM) => setDraft({ ...draft, noiseM })} />
                <NumberField label="Stop dwell (seconds)" value={draft.dwellSeconds} min={0} max={300} step={1} onChange={(dwellSeconds) => setDraft({ ...draft, dwellSeconds })} />
              </div>

              <div className="demo-console__checks">
                <Check label="Loop at the end of the route" checked={draft.loop} onChange={(loop) => setDraft({ ...draft, loop })} />
                <Check label="Pause simulated movement" checked={draft.paused} onChange={(paused) => setDraft({ ...draft, paused })} />
                <Check label="Simulate a network outage" checked={draft.outage} onChange={(outage) => setDraft({ ...draft, outage })} />
              </div>
              <button className="button" disabled={busy}>Save settings</button>
            </form>

            <section className="panel stack">
              <h2>Recent changes</h2>
              {control.audit.length === 0 ? <p className="muted">No changes recorded yet.</p> : (
                <ol className="demo-console__audit">
                  {[...control.audit].reverse().map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.action.replaceAll('_', ' ').toLocaleLowerCase()}</strong>
                      {' '}by {entry.username} · {new Date(entry.atMs).toLocaleString()}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        ) : <p className="muted">Loading demo controls…</p>}
      </main>
    </>
  );
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="field__input" type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="demo-console__check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}</label>;
}

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Could not reach the API.';
}
