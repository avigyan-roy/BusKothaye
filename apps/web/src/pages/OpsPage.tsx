import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { OPS_POLL_MS, type DebugDto } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { api, ApiError } from '../lib/api.js';
import { loadSession } from '../lib/session.js';
import { formatDistance, formatElapsed } from '../lib/format.js';
import { en } from '../content/en.js';
import './ops-page.css';

/**
 * Diagnostics for one journey.
 *
 * Protected, including for demonstration journeys: the page shows contributors'
 * projected positions and decision history, and none of that is public. Nothing
 * is fetched until a capability has been supplied, so an unauthenticated visit
 * reveals nothing at all — not even whether the journey exists.
 */
export function OpsPage() {
  const { journeyId = '' } = useParams<{ journeyId: string }>();
  const [token, setToken] = useState<string | null>(() => {
    const session = loadSession();
    // The person who started the journey already holds a capability in this
    // browser session; nobody else does.
    if (session?.journeyId !== journeyId) return null;
    return session.opsToken ?? session.token;
  });
  const [input, setInput] = useState('');
  const [debug, setDebug] = useState<DebugDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (token === null) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(poll, OPS_POLL_MS * 3);
        return;
      }
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        const next = await api.getDebug(journeyId, token, controller.signal);
        if (!cancelled) {
          setDebug(next);
          setError(null);
        }
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
          setError(en.ops.unauthorised);
          setToken(null);
          return;
        }
        setError(en.errors.offline);
      }
      if (!cancelled) timer = window.setTimeout(poll, OPS_POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      inFlight.current?.abort();
    };
  }, [journeyId, token]);

  if (token === null) {
    return (
      <>
        <Header action={{ label: en.header.passengerLink, to: '/' }} />
        <main className="page stack" style={{ maxWidth: 520 }}>
          <h1>{en.ops.title}</h1>
          <p className="muted">{en.ops.tokenPrompt}</p>
          {error !== null ? <p className="notice notice--danger">{error}</p> : null}
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (input.trim().length > 0) setToken(input.trim());
            }}
          >
            <label className="field" htmlFor="ops-token">
              <span className="field__label">{en.ops.tokenLabel}</span>
              <input
                id="ops-token"
                className="field__input"
                type="password"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                autoComplete="off"
              />
            </label>
            <button type="submit" className="button">
              {en.ops.open}
            </button>
          </form>
        </main>
      </>
    );
  }

  return (
    <>
      <Header action={{ label: en.header.passengerLink, to: '/' }} />
      <main className="page ops stack">
        <h1>{en.ops.title}</h1>
        <p className="meta">
          {journeyId} · <Link to={`/r/${debug?.routeId ?? ''}`}>{en.header.passengerLink}</Link>
        </p>
        {error !== null ? <p className="notice notice--warning">{error}</p> : null}

        {debug === null ? (
          <p>{en.common.loading}</p>
        ) : (
          <>
            <section className="panel stack">
              <h2>{en.ops.fusedState}</h2>
              <p>
                <StatusBadge mode={debug.mode} />
                {debug.isDemo ? <span className="meta"> · {en.common.demoJourney}</span> : null}
              </p>
              {debug.anchor === null ? (
                <p className="muted">{en.journeys.waitingFirstFix}</p>
              ) : (
                <dl className="ops__facts">
                  <dt>Along route</dt>
                  <dd>{formatDistance(debug.anchor.sM)}</dd>
                  <dt>Speed</dt>
                  <dd>{(debug.anchor.speedMps * 3.6).toFixed(1)} km/h</dd>
                  <dt>Sigma</dt>
                  <dd>{debug.anchor.sigmaM.toFixed(1)} m</dd>
                  <dt>Covariance</dt>
                  <dd className="ops__mono">
                    [{debug.anchor.covariance.map((v) => v.toFixed(2)).join(', ')}]
                  </dd>
                  <dt>State version</dt>
                  <dd>{debug.stateVersion}</dd>
                </dl>
              )}
              {debug.ambiguity !== null ? (
                <p className="notice notice--warning">{debug.ambiguity}</p>
              ) : null}
              {debug.offRoute ? (
                <p className="notice notice--warning">{en.journeys.offRoute}</p>
              ) : null}
            </section>

            <section className="panel stack">
              <h2>{en.ops.sources}</h2>
              {debug.sources.length === 0 ? (
                <p className="muted">{en.ops.noSources}</p>
              ) : (
                <div className="ops__sources">
                  {debug.sources.map((source) => (
                    <article key={source.label} className="ops__source">
                      <h3>
                        {source.label} <span className="meta">· {source.role}</span>
                        {source.isLive ? <span className="ops__live"> live</span> : null}
                      </h3>
                      <dl className="ops__facts ops__facts--dense">
                        <dt>{en.ops.columns.age}</dt>
                        <dd>{formatElapsed(source.ageSeconds) ?? '—'}</dd>
                        <dt>{en.ops.columns.accuracy}</dt>
                        <dd>{source.lastAccuracyM === null ? '—' : `${source.lastAccuracyM.toFixed(0)} m`}</dd>
                        <dt>{en.ops.columns.projected}</dt>
                        <dd>{formatDistance(source.lastProjectedSM) ?? '—'}</dd>
                        <dt>{en.ops.columns.offset}</dt>
                        <dd>{source.lastOffsetM === null ? '—' : `${source.lastOffsetM.toFixed(0)} m`}</dd>
                        <dt>{en.ops.columns.weight}</dt>
                        <dd>
                          {source.weightShare === null
                            ? '—'
                            : `${(source.weightShare * 100).toFixed(0)}%`}
                        </dd>
                        <dt>{en.ops.columns.reputation}</dt>
                        <dd>{source.reputation.toFixed(2)}</dd>
                        <dt>Accepted / rejected</dt>
                        <dd>
                          {source.acceptedCount} / {source.rejectedCount}
                        </dd>
                        <dt>{en.ops.columns.decision}</dt>
                        <dd>{source.lastDecision ?? '—'}</dd>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="panel stack">
              <h2>{en.ops.decisions}</h2>
              <ul className="ops__log">
                {[...debug.decisions]
                  .reverse()
                  .slice(0, 40)
                  .map((decision, index) => (
                    <li key={`${decision.atMs}-${decision.sourceLabel}-${decision.seq}-${index}`}>
                      <span className="ops__mono">#{decision.seq}</span> {decision.sourceLabel}{' '}
                      {decision.accepted ? (
                        <span className="ops__accepted">accepted</span>
                      ) : (
                        <span className="ops__rejected">{decision.reason ?? 'history only'}</span>
                      )}
                      {decision.projectedSM === null
                        ? null
                        : ` · ${formatDistance(decision.projectedSM)}`}
                      {decision.offsetM === null ? null : ` · ${decision.offsetM.toFixed(0)} m off line`}
                    </li>
                  ))}
              </ul>
            </section>

            <section className="panel stack">
              <h2>{en.ops.events}</h2>
              {debug.events.length === 0 ? (
                <p className="muted">No correction or ambiguity events yet.</p>
              ) : (
                <ul className="ops__log">
                  {[...debug.events].reverse().map((event) => (
                    <li key={event.id}>
                      <span className="ops__mono">{event.kind}</span> {event.detail}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel stack">
              <h2>{en.ops.storage}</h2>
              <dl className="ops__facts">
                <dt>Driver</dt>
                <dd>{debug.storage.driver}</dd>
                <dt>Last write</dt>
                <dd>{debug.storage.lastWriteOk ? 'ok' : 'failed'}</dd>
                <dt>Write conflicts</dt>
                <dd>{debug.storage.writeConflicts}</dd>
                <dt>Dropped diagnostics</dt>
                <dd>{debug.storage.droppedDiagnostics}</dd>
              </dl>
            </section>
          </>
        )}
      </main>
    </>
  );
}
