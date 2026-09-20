import { Link } from 'react-router-dom';
import type { JourneyMode, StopEta } from '@buskothay/shared';
import type { AccountSession } from '../../lib/auth-session.js';
import type { ContributorSession } from '../../lib/session.js';
import type { SharingState } from '../contribution/useGeoSharing.js';
import { arrivalAt } from '../../lib/format.js';
import './boarding-panel.css';

export function BoardingPanel({
  account,
  session,
  selectedStop,
  boardedStopName,
  futureStops,
  mode,
  isDemo,
  canBoard,
  busy,
  error,
  sharing,
  onBoard,
  onStartSharing,
  onPauseSharing,
  onLeave,
}: {
  account: AccountSession | null;
  session: ContributorSession | null;
  selectedStop: StopEta | null;
  boardedStopName: string | null;
  futureStops: readonly StopEta[];
  mode: JourneyMode;
  isDemo: boolean;
  canBoard: boolean;
  busy: boolean;
  error: string | null;
  sharing: SharingState;
  onBoard: () => void;
  onStartSharing: () => void;
  onPauseSharing: () => void;
  onLeave: () => void;
}) {
  if (session?.joinedVia === 'boarding') {
    return (
      <section className="boarding info-pane__section" aria-labelledby="onboard-heading">
        <div className="boarding__heading">
          <span className="boarding__status" aria-hidden="true">✓</span>
          <div>
            <h3 id="onboard-heading">You’re aboard</h3>
            <p className="meta">Boarded at {boardedStopName ?? 'your selected stop'}</p>
          </div>
        </div>

        {mode === 'ENDED' ? (
          <>
            <p className="notice notice--warning">This journey has ended. Location sharing is off.</p>
            <div className="boarding__actions">
              <button type="button" className="button button--secondary" onClick={onLeave}>
                I got off
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h3>Stops ahead</h3>
              {futureStops.length === 0 ? (
                <p className="muted">No later checkpoint remains on this route.</p>
              ) : (
                <ol className="boarding__etas">
                  {futureStops.slice(0, 4).map((stop) => (
                    <li key={stop.stopId}>
                      <span>{stop.name}</span>
                      <strong>{etaText(stop)}</strong>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="boarding__sharing">
              <h3>Help update this bus</h3>
              <p className="meta">
                Location sharing is optional and starts only when you press the button below.
              </p>
              {isDemo ? (
                <p className="notice notice--quiet">
                  Bus movement is simulated. If you share, this device’s real location is sent
                  through the normal validation and retention rules.
                </p>
              ) : null}
              {sharing.errorCode === 'denied' ? (
                <p className="notice notice--danger">
                  Location permission was refused. You remain aboard, but this device is not
                  contributing. Allow location in browser settings to retry.
                </p>
              ) : null}
              {sharing.errorCode === 'unavailable' ? (
                <p className="notice notice--warning">
                  This browser could not provide a location. Check device location services and retry.
                </p>
              ) : null}
              <div className="boarding__actions">
                {sharing.status === 'sharing' ? (
                  <button type="button" className="button button--secondary" onClick={onPauseSharing}>
                    Pause location sharing
                  </button>
                ) : (
                  <button type="button" className="button" onClick={onStartSharing}>
                    {sharing.status === 'paused' ? 'Resume location sharing' : 'Share my live location'}
                  </button>
                )}
                <button type="button" className="button button--secondary" onClick={onLeave}>
                  I got off
                </button>
              </div>
              <p className="meta" aria-live="polite">
                {sharing.status === 'sharing'
                  ? 'Your location is being shared with this journey.'
                  : 'Your location is not being shared.'}
              </p>
            </div>
          </>
        )}
        {error ? <p className="notice notice--danger">{error}</p> : null}
      </section>
    );
  }

  if (!canBoard) return null;
  if (account === null) {
    return (
      <section className="boarding boarding--ready info-pane__section">
        <h3>The bus is at {selectedStop?.name ?? 'this stop'}</h3>
        <p className="meta">Sign in as a passenger to mark that you boarded.</p>
        <Link className="button" to="/account">Sign in to board</Link>
      </section>
    );
  }
  if (account.account.kind !== 'community' || account.account.role !== 'passenger') return null;

  return (
    <section className="boarding boarding--ready info-pane__section">
      <h3>The bus is at {selectedStop?.name ?? 'this stop'}</h3>
      <p className="meta">
        Boarding unlocks the stops ahead. It does not request or send your location.
      </p>
      <button type="button" className="button" disabled={busy} onClick={onBoard}>
        I boarded this bus
      </button>
      {error ? <p className="notice notice--danger">{error}</p> : null}
    </section>
  );
}

/** The same clock-first arrival the rest of the application shows. */
function etaText(stop: StopEta): string {
  if (stop.status === 'near') return 'At stop';
  const arrival = arrivalAt(stop.etaSeconds);
  return arrival === null ? 'ETA unavailable' : `${arrival.clock} · ~${arrival.minutes} min`;
}
