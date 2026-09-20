import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { JoinRole } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import { useGeoSharing } from '../features/contribution/useGeoSharing.js';
import { api, ApiError } from '../lib/api.js';
import {
  clearSession,
  loadSession,
  saveSession,
  type ContributorSession,
} from '../lib/session.js';
import { en } from '../content/en.js';
import { useRoute } from '../hooks/useRoute.js';
import { useRoutes } from '../hooks/useRoutes.js';
import { RouteSwitcher } from '../features/journeys/RouteSwitcher.js';
import {
  loadAccountSession,
  saveAccountSession,
  type AccountSession,
} from '../lib/auth-session.js';
import './drive-page.css';

/**
 * The contributor page.
 *
 * Two actions to begin with, an explicit consent step before any location is
 * requested, and controls that mean exactly what they say: pause stops the GPS
 * but keeps control of the journey; stop gives up the capability; end finishes
 * the journey for everybody and asks first.
 */
export function DrivePage() {
  const [searchParams] = useSearchParams();
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const { routes, error: routesError } = useRoutes();
  // No hardcoded starting route: the first one the server says can be tracked.
  const routeId =
    selectedRouteId ?? routes.find((candidate) => candidate.trackingAvailable)?.id ?? '';
  const { route } = useRoute(routeId);
  const [account, setAccount] = useState<AccountSession | null>(() => loadAccountSession());
  const [session, setSession] = useState<ContributorSession | null>(() => loadSession());
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const sharing = useGeoSharing(session, setSession);

  const [joinJourneyId, setJoinJourneyId] = useState(searchParams.get('journey') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [joinRole, setJoinRole] = useState<JoinRole>('passenger');

  useEffect(() => {
    if (session !== null) saveSession(session);
  }, [session]);

  const startJourney = async () => {
    if (account === null || account.account.role !== 'driver') {
      setFormError(en.account.requiredForCrew);
      return;
    }
    if (routeId === '') {
      setFormError('No route with tracking geometry is available yet.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const created = await api.createJourney(
        routeId,
        crypto.randomUUID(),
        account.token,
      );
      setSession({
        journeyId: created.journeyId,
        routeId: created.routeId,
        contributorId: created.contributorId,
        token: created.contributorToken,
        role: 'driver',
        opsToken: created.opsToken,
        joinCode: created.joinCode,
        isDemo: created.isDemo,
        createdAtMs: created.createdAtMs,
        nextSeq: 0,
      });
    } catch (error) {
      setFormError(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const joinJourney = async () => {
    if (account === null) {
      setFormError(en.account.requiredForCrew);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      // A person may paste the whole link they were sent.
      const journeyId = extractJourneyId(joinJourneyId);
      if (journeyId === null) {
        setFormError(en.contribute.journeyIdLabel);
        return;
      }
      let activeAccount = account;
      if (activeAccount.account.role !== joinRole) {
        activeAccount = saveAccountSession(await api.selectRole(activeAccount.token, joinRole));
        setAccount(activeAccount);
      }
      const joined = await api.joinJourney(
        journeyId,
        joinCode,
        joinRole,
        crypto.randomUUID(),
        activeAccount.token,
      );
      setSession({
        journeyId: joined.journeyId,
        routeId: joined.routeId,
        contributorId: joined.contributorId,
        token: joined.contributorToken,
        role: joined.role,
        isDemo: joined.isDemo,
        createdAtMs: joined.joinedAtMs,
        joinedVia: 'join-code',
        nextSeq: 0,
      });
    } catch (error) {
      setFormError(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (session?.role === 'driver') {
      sharing.pause();
      return;
    }
    await sharing.stop(true);
    clearSession();
    setSession(null);
  };

  const endJourney = async () => {
    if (session === null) return;
    setBusy(true);
    try {
      if (account === null) throw new ApiError(401, 'UNAUTHENTICATED', en.account.requiredForCrew);
      await api.endJourney(session.journeyId, account.token);
      await sharing.stop(false);
      clearSession();
      setSession(null);
      setShowEndConfirm(false);
    } catch (error) {
      setFormError(messageFor(error));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, value: string) => {
    let succeeded = false;
    try {
      await navigator.clipboard.writeText(value);
      succeeded = true;
    } catch {
      // Older browsers and insecure origins may only support selection plus the
      // legacy copy command. The exact value remains visible if that also fails.
      const selection = window.getSelection();
      const node = document.getElementById(`copy-${label}`);
      if (node !== null && selection !== null) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
        succeeded = document.execCommand('copy');
      }
    }
    if (succeeded) {
      setCopied(label);
      setFormError(null);
      window.setTimeout(() => setCopied(null), 2000);
    } else {
      setFormError('Copy was blocked by this browser. Select the value shown above and copy it manually.');
    }
  };

  return (
    <>
      <Header
        routeCode={route?.dto.code}
        routeDirection={route ? `${route.dto.origin} → ${route.dto.destination}` : undefined}
        action={{ label: en.header.passengerLink, to: '/' }}
      />

      <main className="page drive stack">
        <h1>{en.contribute.title}</h1>
        <p className="muted">{en.contribute.intro}</p>

        {account === null ? (
          <p className="notice notice--warning">
            {en.account.requiredForCrew} <Link to="/account?entry=crew">{en.account.title}</Link>
          </p>
        ) : null}

        {formError !== null ? <p className="notice notice--danger">{formError}</p> : null}

        {session === null ? (
          <>
            <section className="panel stack">
              <h2>{en.contribute.startJourney}</h2>
              <p className="muted">
                {en.contribute.routeLabel}: {route ? route.dto.name : en.common.loading}
              </p>
              <button type="button" className="button" onClick={startJourney} disabled={busy}>
                {en.contribute.startJourney}
              </button>
              {routesError ? <p className="notice notice--warning">The route directory could not be loaded.</p> : null}
              {routes.length > 0 ? (
                <RouteSwitcher
                  routes={routes}
                  currentRouteId={routeId}
                  onSelect={setSelectedRouteId}
                  compact
                />
              ) : null}
            </section>

            <section className="panel stack">
              <h2>{en.contribute.joinJourney}</h2>
              <label className="field" htmlFor="journey-id">
                <span className="field__label">{en.contribute.journeyIdLabel}</span>
                <input
                  id="journey-id"
                  className="field__input"
                  value={joinJourneyId}
                  onChange={(event) => setJoinJourneyId(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="field" htmlFor="join-code">
                <span className="field__label">{en.contribute.joinCodeLabel}</span>
                <input
                  id="join-code"
                  className="field__input"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  // Typed, pasted, upper or lower case, with or without the dash.
                  placeholder="BUS-7K4M9Q"
                  autoComplete="off"
                  autoCapitalize="characters"
                />
              </label>
              <fieldset className="drive__roles">
                <legend className="field__label">{en.contribute.joinAs}</legend>
                <label>
                  <input
                    type="radio"
                    name="role"
                    checked={joinRole === 'passenger'}
                    onChange={() => setJoinRole('passenger')}
                  />{' '}
                  {en.contribute.rolePassenger}
                </label>
                <label>
                  <input
                    type="radio"
                    name="role"
                    checked={joinRole === 'conductor'}
                    onChange={() => setJoinRole('conductor')}
                  />{' '}
                  {en.contribute.roleConductor}
                </label>
              </fieldset>
              <p className="meta">{en.contribute.roleNote}</p>
              <button
                type="button"
                className="button"
                onClick={joinJourney}
                disabled={busy || joinCode.trim().length === 0 || joinJourneyId.trim().length === 0}
              >
                {en.contribute.joinJourney}
              </button>
            </section>
          </>
        ) : (
          <>
            {session.joinCode !== undefined ? (
              <section className="panel stack">
                <h2>{en.contribute.joinCodeLabel}</h2>
                <p id="copy-code" className="drive__code">
                  {session.joinCode}
                </p>
                <p id="copy-link" className="drive__copy-value">
                  {`${window.location.origin}/drive?journey=${session.journeyId}`}
                </p>
                <div className="drive__actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => copy('code', session.joinCode ?? '')}
                  >
                    {copied === 'code' ? en.common.copied : en.contribute.copyCode}
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() =>
                      copy('link', `${window.location.origin}/drive?journey=${session.journeyId}`)
                    }
                  >
                    {copied === 'link' ? en.common.copied : en.contribute.copyLink}
                  </button>
                  <Link className="button button--secondary" to={`/r/${session.routeId}`}>
                    {en.contribute.openPassengerView}
                  </Link>
                </div>
                <p className="meta">
                  The link contains the journey ID only. Whoever opens it still has to enter the
                  join code.
                </p>
              </section>
            ) : null}

            <section className="panel stack">
              <h2>{en.contribute.consentTitle}</h2>
              <p>{en.contribute.consentBody}</p>
              <details>
                <summary>{en.contribute.retentionSummary}</summary>
                <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
                  {en.contribute.retentionBody}
                </p>
              </details>

              <p className="drive__status">
                {sharing.state.status === 'sharing'
                  ? en.contribute.sharingOn
                  : sharing.state.status === 'paused'
                    ? en.contribute.sharingOff
                    : en.contribute.notSharingYet}
                {sharing.state.queuedCount > 0
                  ? ` · ${en.contribute.queued(sharing.state.queuedCount)}`
                  : null}
              </p>

              {sharing.state.lastDecision !== null ? (
                <p className="meta">
                  {en.contribute.lastDecision}:{' '}
                  {sharing.state.lastDecision.accepted
                    ? en.contribute.accepted
                    : (en.reject[sharing.state.lastDecision.reason ?? 'DUPLICATE'] ??
                      en.contribute.accepted)}
                </p>
              ) : null}

              {sharing.state.errorCode === 'denied' ? (
                <p className="notice notice--danger">{en.contribute.permissionDenied}</p>
              ) : null}
              {sharing.state.errorCode === 'unavailable' ? (
                <p className="notice notice--warning">{en.contribute.permissionUnavailable}</p>
              ) : null}
              {sharing.state.wakeLockDenied && sharing.state.status === 'sharing' ? (
                <p className="notice notice--warning">{en.contribute.wakeLockDenied}</p>
              ) : null}

              <p className="notice notice--quiet">{en.contribute.backgroundWarning}</p>

              <div className="drive__actions">
                {sharing.state.status === 'sharing' ? (
                  <button type="button" className="button button--secondary" onClick={sharing.pause}>
                    {en.contribute.pauseSharing}
                  </button>
                ) : (
                  <button type="button" className="button" onClick={sharing.start}>
                    {sharing.state.status === 'paused'
                      ? en.contribute.resumeSharing
                      : en.contribute.startSharing}
                  </button>
                )}
                {session.role !== 'driver' ? (
                  <button type="button" className="button button--secondary" onClick={leave}>
                    {en.contribute.stopSharing}
                  </button>
                ) : null}
              </div>
              <p className="meta">{en.contribute.keepScreenOpen}</p>
            </section>

            {session.role === 'driver' || session.role === 'conductor' ? (
              <section className="panel stack">
                <h2>{en.contribute.endJourney}</h2>
                {showEndConfirm ? (
                  <div className="stack">
                    <p>
                      <strong>{en.contribute.endConfirmTitle}</strong>
                    </p>
                    <p className="muted">{en.contribute.endConfirmBody}</p>
                    <div className="drive__actions">
                      <button
                        type="button"
                        className="button button--danger"
                        onClick={endJourney}
                        disabled={busy}
                      >
                        {en.contribute.endConfirm}
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => setShowEndConfirm(false)}
                      >
                        {en.contribute.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => setShowEndConfirm(true)}
                  >
                    {en.contribute.endJourney}
                  </button>
                )}
                {session.opsToken !== undefined ? (
                  <p className="meta">
                    Diagnostics for this journey are at{' '}
                    <Link to={`/ops/${session.journeyId}`}>/ops/{session.journeyId}</Link>. It will
                    ask for the diagnostics token, which is held in this browser session only.
                  </p>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}

/** Accept a journey ID, a full link, or a link pasted with surrounding text. */
function extractJourneyId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const fromQuery = /[?&]journey=([A-Za-z0-9_-]+)/.exec(trimmed);
  if (fromQuery) return fromQuery[1] ?? null;
  const bare = /^[A-Za-z0-9_-]+$/.exec(trimmed);
  return bare ? trimmed : null;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return en.errors.offline;
}
