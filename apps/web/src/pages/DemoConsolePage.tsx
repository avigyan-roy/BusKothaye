import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { DemoControlDto, DemoFleetConfig } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import { RouteSwitcher } from '../features/journeys/RouteSwitcher.js';
import { useRoute } from '../hooks/useRoute.js';
import { useRoutes } from '../hooks/useRoutes.js';
import { api, ApiError } from '../lib/api.js';
import { loadAccountSession } from '../lib/auth-session.js';
import './demo-console-page.css';

export function DemoConsolePage() {
  const account = loadAccountSession();
  const { routes, error: routesError } = useRoutes();
  const [control, setControl] = useState<DemoControlDto | null>(null);
  const [draft, setDraft] = useState<DemoFleetConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { route } = useRoute(draft?.routeId ?? 'ac24-patuli-howrah');

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      const next = await api.getDemoControl(account.token);
      setControl(next);
      setDraft((current) => current ?? next.config);
      setError(null);
    } catch (caught) {
      setError(messageFor(caught));
    }
  }, [account]);

  useEffect(() => {
    void refresh();
    if (!account) return;
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
          <p className="eyebrow">Simulation controls</p>
          <h1>Demo fleet</h1>
          <p className="muted">
            This switch controls the shared simulated fleet for everyone using this deployment.
            Simulated journeys remain visibly marked Demo.
          </p>
        </div>

        {!account ? (
          <p className="notice notice--warning">
            Sign in before changing the demo fleet. <Link to="/account">Open account</Link>
          </p>
        ) : null}
        {error ? <p className="notice notice--danger">{error}</p> : null}

        {control && draft && account ? (
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
                    Turn demo on
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={busy}
                    onClick={() => void act(() => api.switchDemo(account.token, false))}
                  >
                    Turn demo off
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
              <h2>Fleet settings</h2>
              {routesError ? <p className="notice notice--warning">The route directory could not be loaded.</p> : null}
              <RouteSwitcher
                routes={routes}
                currentRouteId={draft.routeId}
                compact
                onSelect={(routeId) => setDraft({ ...draft, routeId, startStopId: null })}
              />

              <label className="field">
                <span className="field__label">Starting checkpoint</span>
                <select
                  className="field__input"
                  value={draft.startStopId ?? ''}
                  onChange={(event) => setDraft({ ...draft, startStopId: event.target.value || null })}
                >
                  <option value="">Route origin</option>
                  {route?.dto.stops.map((stop) => (
                    <option key={stop.id} value={stop.id}>{stop.name}</option>
                  ))}
                </select>
              </label>

              <div className="demo-console__grid">
                <NumberField label="Buses" value={draft.busCount} min={1} max={10} onChange={(busCount) => setDraft({ ...draft, busCount })} />
                <NumberField label="Sources per bus" value={draft.sourcesPerBus} min={1} max={5} onChange={(sourcesPerBus) => setDraft({ ...draft, sourcesPerBus })} />
                <NumberField label="Speed (km/h)" value={draft.speedKmh} min={0} max={80} step={1} onChange={(speedKmh) => setDraft({ ...draft, speedKmh })} />
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
        ) : account ? <p className="muted">Loading demo controls…</p> : null}
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
