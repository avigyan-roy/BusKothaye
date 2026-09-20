import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { positionAt, stopKey, type JourneyMode, type StopEta } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import { MapView } from '../features/map/MapView.js';
import { BoardingPanel } from '../features/journeys/BoardingPanel.js';
import { JourneySelector } from '../features/journeys/JourneySelector.js';
import { RouteDetails } from '../features/journeys/RouteDetails.js';
import { RouteSwitcher } from '../features/journeys/RouteSwitcher.js';
import { ArrivalClock } from '../features/passenger/ArrivalClock.js';
import { LiveStatus } from '../features/passenger/LiveStatus.js';
import { StopTimeline } from '../features/passenger/StopTimeline.js';
import { livenessOf } from '../features/passenger/liveness.js';
import { progressFraction, routeProgress } from '../features/passenger/stop-progress.js';
import { useGeoSharing } from '../features/contribution/useGeoSharing.js';
import { useRoute } from '../hooks/useRoute.js';
import { preferredJourney, useActiveJourneys } from '../hooks/useActiveJourneys.js';
import { useJourneyState } from '../hooks/useJourneyState.js';
import { useNow } from '../hooks/useNow.js';
import { useProjectedJourney } from '../hooks/useProjectedJourney.js';
import { useRoutes } from '../hooks/useRoutes.js';
import {
  clearSession,
  loadPreferredStop,
  loadSession,
  savePreferredStop,
  saveSession,
  type ContributorSession,
} from '../lib/session.js';
import { saveStopKey } from '../lib/stop-preference.js';
import { loadAccountSession, type AccountSession } from '../lib/auth-session.js';
import { api, ApiError } from '../lib/api.js';
import { formatDistance } from '../lib/format.js';
import { en } from '../content/en.js';
import { site } from '../config/site.js';
import './route-page.css';

/**
 * The details screen: the map, and everything the map cannot say in words.
 *
 * It is a continuation of the search, not a separate dashboard — the stop the
 * passenger chose is still the subject, still named at the top, and still the
 * thing the big number is about. The map shows *where*; the pane beside it
 * shows *when*, and the two are driven by the same journey state so they cannot
 * drift apart.
 *
 * Three things change on completely different timescales and so are fetched
 * separately: the route (almost never), the list of journeys (minutes), and one
 * journey's state (every second). The bus marker is re-projected between polls
 * with the same bounded projection the server uses, so it obeys the same caps
 * even while the network is down.
 */
export function RoutePage() {
  // The router only matches this screen with a route ID present; the fallback
  // exists so a malformed address produces the route-unavailable screen rather
  // than a crash.
  const { routeId = '' } = useParams<{ routeId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const nowMs = useNow();

  const { route, isLoading: routeLoading, error: routeError, reload } = useRoute(routeId);
  const routeDirectory = useRoutes();
  const { journeys, isLoading: journeysLoading, error: journeysError } = useActiveJourneys(routeId);

  const [account, setAccount] = useState<AccountSession | null>(() => loadAccountSession());
  const [contributorSession, setContributorSession] = useState<ContributorSession | null>(() =>
    loadSession(),
  );
  const [boardingBusy, setBoardingBusy] = useState(false);
  const [boardingError, setBoardingError] = useState<string | null>(null);
  const [isPaneExpanded, setPaneExpanded] = useState(false);

  const sharing = useGeoSharing(contributorSession, (next) => {
    setContributorSession(next);
    saveSession(next);
  });
  const pauseSharing = sharing.pause;

  useEffect(() => {
    const refresh = () => setAccount(loadAccountSession());
    window.addEventListener('buskothay-account-changed', refresh);
    return () => window.removeEventListener('buskothay-account-changed', refresh);
  }, []);

  const onboardSession =
    contributorSession?.joinedVia === 'boarding' && contributorSession.routeId === routeId
      ? contributorSession
      : null;

  const [chosenJourneyId, setChosenJourneyId] = useState<string | null>(null);
  const activeJourneyId = useMemo(() => {
    if (onboardSession !== null) return onboardSession.journeyId;
    if (chosenJourneyId !== null && journeys.some((j) => j.journeyId === chosenJourneyId)) {
      return chosenJourneyId;
    }
    return preferredJourney(journeys)?.journeyId ?? null;
  }, [chosenJourneyId, journeys, onboardSession]);

  const { snapshot, isReconnecting } = useJourneyState(activeJourneyId);
  const projected = useProjectedJourney(snapshot);

  // --- Stop selection: URL first, then the remembered preference. ------------
  const stopFromUrl = searchParams.get('stop');
  const [selectedStopId, setSelectedStopId] = useState<string | null>(stopFromUrl);

  useEffect(() => {
    if (route === null) return;
    const candidate =
      stopFromUrl ?? selectedStopId ?? loadPreferredStop(routeId) ?? route.dto.stops.at(-1)?.id ?? null;
    if (candidate !== null && route.dto.stops.some((s) => s.id === candidate)) {
      setSelectedStopId(candidate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, stopFromUrl, routeId]);

  const selectStop = (stopId: string) => {
    setSelectedStopId(stopId);
    savePreferredStop(routeId, stopId);
    // Keep the application-wide "my stop" in step, so going back to the finder
    // does not silently switch the passenger to a different stop than the one
    // they are looking at here.
    const name = route?.dto.stops.find((stop) => stop.id === stopId)?.name;
    saveStopKey(stopKey(name ?? stopId));
    // A shareable link carries the stop, and nothing else. Capabilities never
    // appear in a URL.
    const next = new URLSearchParams(searchParams);
    next.set('stop', stopId);
    setSearchParams(next, { replace: true });
  };

  const state = snapshot?.state ?? null;
  const mode: JourneyMode = projected?.mode ?? state?.mode ?? 'PENDING';
  const stops: readonly StopEta[] = useMemo(() => state?.stops ?? emptyStops(route), [state, route]);
  const selectedStop = stops.find((s) => s.stopId === selectedStopId) ?? null;
  const selectedRouteStop = route?.dto.stops.find((stop) => stop.id === selectedStopId) ?? null;
  const selectedIndex = stops.findIndex((stop) => stop.stopId === selectedStopId);

  const hasJourney = activeJourneyId !== null;
  const liveness = livenessOf(hasJourney ? mode : null);
  const progress = useMemo(
    () => routeProgress(stops, hasJourney ? mode : null),
    [stops, mode, hasJourney],
  );

  const boardedStopName =
    onboardSession?.boardedStopId === undefined
      ? null
      : route?.dto.stops.find((stop) => stop.id === onboardSession.boardedStopId)?.name ?? null;
  const futureStops = useMemo(() => {
    if (route === null || onboardSession?.boardedStopId === undefined) return [];
    const boardedIndex = route.dto.stops.findIndex(
      (stop) => stop.id === onboardSession.boardedStopId,
    );
    if (boardedIndex < 0) return [];
    const futureIds = new Set(route.dto.stops.slice(boardedIndex + 1).map((stop) => stop.id));
    return stops.filter((stop) => futureIds.has(stop.stopId) && stop.status !== 'passed');
  }, [onboardSession?.boardedStopId, route, stops]);

  const busPosition = useMemo(() => {
    if (route === null || projected?.sM == null) return null;
    if (mode === 'PENDING') return null;
    return positionAt(route, projected.sM);
  }, [route, projected?.sM, mode]);

  useEffect(() => {
    if (mode === 'ENDED' && onboardSession !== null) pauseSharing();
  }, [mode, onboardSession, pauseSharing]);

  const board = async () => {
    if (account === null || activeJourneyId === null || selectedStopId === null) return;
    setBoardingBusy(true);
    setBoardingError(null);
    try {
      const boarded = await api.boardJourney(
        activeJourneyId,
        selectedStopId,
        crypto.randomUUID(),
        account.token,
      );
      const next: ContributorSession = {
        journeyId: boarded.journeyId,
        routeId: boarded.routeId,
        contributorId: boarded.contributorId,
        token: boarded.contributorToken,
        role: 'passenger',
        isDemo: boarded.isDemo,
        createdAtMs: boarded.boardedAtMs,
        joinedVia: 'boarding',
        boardedStopId: boarded.boardedStopId,
        nextSeq: boarded.nextSeq,
      };
      saveSession(next);
      setContributorSession(next);
    } catch (caught) {
      setBoardingError(caught instanceof ApiError ? caught.message : en.errors.offline);
    } finally {
      setBoardingBusy(false);
    }
  };

  const leaveBus = async () => {
    await sharing.stop(true);
    clearSession();
    setContributorSession(null);
    setBoardingError(null);
  };

  if (routeLoading) {
    return (
      <>
        <Header />
        <main className="page"><p className="muted">{en.common.loading}</p></main>
      </>
    );
  }

  if (routeError !== null || route === null) {
    return (
      <>
        <Header />
        <main className="page stack" style={{ maxWidth: 560 }}>
          <h1>
            {routeError === 'ROUTE_UNAVAILABLE'
              ? en.errors.geometryUnavailable
              : en.errors.routeUnavailable}
          </h1>
          <p className="muted">
            {routeError === 'ROUTE_UNAVAILABLE'
              ? en.errors.geometryUnavailableHelp
              : en.errors.offline}
          </p>
          <button type="button" className="button button--secondary" onClick={reload}>
            {en.common.retry}
          </button>
          {routeDirectory.routes.length > 0 ? (
            <RouteSwitcher routes={routeDirectory.routes} currentRouteId={routeId} />
          ) : null}
        </main>
      </>
    );
  }

  const direction = en.find.towards(route.dto.destination);
  const progressLabel =
    liveness === 'none'
      ? en.find.busPositionUnknown
      : progress.busIndex !== null && progress.rows[progress.busIndex]?.progress === 'at'
        ? en.find.busStandingAt(progress.rows[progress.busIndex]!.stop.name)
        : en.find.busPassedCount(progress.passedCount, progress.rows.length);

  return (
    <>
      <Header routeCode={route.dto.code} routeDirection={direction} />
      <main className="details">
        <div className="details__map">
          <MapView
            route={route.dto}
            stops={stops}
            selectedStopId={selectedStopId}
            onSelectStop={selectStop}
            bus={busPosition}
            busMode={mode}
            confidenceM={state?.confidenceM ?? null}
            isDemo={state?.isDemo ?? false}
          />
        </div>

        <div className={`info-pane${isPaneExpanded ? ' is-expanded' : ''}`}>
          <button
            className="info-pane__grabber"
            type="button"
            aria-expanded={isPaneExpanded}
            aria-label={isPaneExpanded ? en.sheet.collapse : en.sheet.expand}
            onClick={() => setPaneExpanded((open) => !open)}
          >
            <i />
          </button>

          <div className="trip-head">
            <div className="crumb">
              <button className="back-btn" type="button" onClick={() => navigate(-1)}>
                ← {en.common.back}
              </button>
            </div>
            <div className="trip-head__top">
              <span className="route-badge">{route.dto.code}</span>
              <div>
                <div className="trip-head__dest">{direction}</div>
                <div className="trip-head__route">{route.dto.name}</div>
              </div>
              {state?.isDemo === true ? <span className="demo-badge">{en.common.demoBadge}</span> : null}
            </div>
            <div className="trip-head__live">
              <LiveStatus
                mode={hasJourney ? mode : null}
                ageSeconds={projected?.ageSeconds ?? state?.lastFixAgeSeconds ?? null}
              />
              {isReconnecting ? (
                <span className="live-status__age">{en.freshness.reconnecting}</span>
              ) : null}
            </div>
          </div>

          <div className="selected-stop">
            <div>
              <span className="selected-stop__label">{en.find.yourStop}</span>
              <h1 className="selected-stop__name">
                {selectedStop?.name ?? selectedRouteStop?.name ?? en.route.chooseStop}
              </h1>
              <span className="selected-stop__dist">
                {selectedRouteStop === null
                  ? ''
                  : `${en.find.alongRoute(formatDistance(selectedRouteStop.sM) ?? '')} · ${en.find.stopPosition(selectedIndex + 1, stops.length)}`}
              </span>
            </div>
            <ArrivalClock
              stop={selectedStop}
              mode={hasJourney ? mode : null}
              nowMs={nowMs}
            />
          </div>

          <div className="progress-summary">
            <span>{progressLabel}</span>
            <span className="route-progress">
              <i style={{ width: `${(progressFraction(progress, stops.length) * 100).toFixed(1)}%` }} />
            </span>
          </div>

          {state?.offRoute === true ? (
            <p className="notice notice--warning info-pane__notice">
              {en.journeys.offRoute} {en.journeys.offRouteHelp}
            </p>
          ) : null}

          {journeysError !== null ? (
            <p className="notice notice--warning info-pane__notice">{en.journeys.listUnavailable}</p>
          ) : null}

          {liveness === 'none' ? (
            <div className="no-live">
              <h3>
                {journeysLoading && !hasJourney
                  ? en.common.loading
                  : en.find.noLiveBusOn(route.dto.code)}
              </h3>
              {journeysLoading && !hasJourney ? null : (
                <p>{en.find.noLiveBusHelp(selectedStop?.name ?? selectedRouteStop?.name ?? '')}</p>
              )}
              <Link className="button button--secondary" to={site.drivePath}>
                {en.find.shareGps}
              </Link>
            </div>
          ) : null}

          <JourneySelector
            journeys={journeys}
            selectedId={activeJourneyId}
            onSelect={setChosenJourneyId}
          />

          <BoardingPanel
            account={account}
            session={onboardSession}
            selectedStop={selectedStop}
            boardedStopName={boardedStopName}
            futureStops={futureStops}
            mode={mode}
            isDemo={state?.isDemo ?? false}
            canBoard={
              onboardSession === null &&
              activeJourneyId !== null &&
              route.dto.version === state?.routeVersion &&
              state?.boardableStopId === selectedStopId &&
              (mode === 'LIVE' || mode === 'DWELLING')
            }
            busy={boardingBusy}
            error={boardingError}
            sharing={sharing.state}
            onBoard={() => void board()}
            onStartSharing={sharing.start}
            onPauseSharing={sharing.pause}
            onLeave={() => void leaveBus()}
          />

          <StopTimeline
            stops={stops}
            mode={hasJourney ? mode : null}
            selectedStopId={selectedStopId}
            onSelect={selectStop}
            nowMs={nowMs}
          />

          <div className="info-pane__secondary">
            <RouteDetails route={route.dto} />
            <details className="route-details">
              <summary>{en.find.howWorkedOut}</summary>
              <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
                {en.find.howWorkedOutBody}
              </p>
            </details>
            <details className="route-details">
              <summary>{en.find.otherRoutes}</summary>
              <div style={{ marginTop: 'var(--space-3)' }}>
                <RouteSwitcher routes={routeDirectory.routes} currentRouteId={routeId} compact />
              </div>
            </details>
          </div>
        </div>
      </main>
    </>
  );
}

/** Stop rows before any journey exists: names and order, no invented numbers. */
function emptyStops(route: ReturnType<typeof useRoute>['route']): StopEta[] {
  if (route === null) return [];
  return route.dto.stops.map((stop) => ({
    stopId: stop.id,
    name: stop.name,
    distanceM: null,
    status: 'unknown' as const,
    etaSeconds: null,
    etaRangeSeconds: null,
    scheduledTs: null,
    basis: 'unavailable' as const,
  }));
}
