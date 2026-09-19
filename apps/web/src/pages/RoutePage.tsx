import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { positionAt, type JourneyMode, type StopEta } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import { MapView } from '../features/map/MapView.js';
import { ArrivalPanel } from '../features/journeys/ArrivalPanel.js';
import { JourneySheet } from '../features/journeys/JourneySheet.js';
import { JourneyStatus } from '../features/journeys/JourneyStatus.js';
import { StopList } from '../features/journeys/StopList.js';
import { RouteDetails } from '../features/journeys/RouteDetails.js';
import { JourneySelector } from '../features/journeys/JourneySelector.js';
import { BoardingPanel } from '../features/journeys/BoardingPanel.js';
import { useGeoSharing } from '../features/contribution/useGeoSharing.js';
import { RouteSwitcher } from '../features/journeys/RouteSwitcher.js';
import { useRoute } from '../hooks/useRoute.js';
import { preferredJourney, useActiveJourneys } from '../hooks/useActiveJourneys.js';
import { useJourneyState } from '../hooks/useJourneyState.js';
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
import {
  loadAccountSession,
  type AccountSession,
} from '../lib/auth-session.js';
import { api, ApiError } from '../lib/api.js';
import { site } from '../config/site.js';
import { en } from '../content/en.js';
import './route-page.css';

/**
 * The passenger screen: a full-screen map with one sheet of information on it.
 *
 * The map is the page. There is no header and no page scrolling — everything
 * else floats over the map and is sized to leave the map visible, because the
 * question being answered is "where is the bus" and that is a spatial question.
 *
 * The page holds three independent things — the route, the list of journeys, and
 * one journey's state — because they change on completely different timescales.
 * The bus marker is derived from the shared bounded projection, so it obeys the
 * same caps the server does even while the network is down.
 */
export function RoutePage() {
  const params = useParams<{ routeId?: string }>();
  const routeId = params.routeId ?? site.defaultRouteId;
  const [searchParams, setSearchParams] = useSearchParams();

  const { route, isLoading: routeLoading, error: routeError, reload } = useRoute(routeId);
  const routeDirectory = useRoutes();
  const { journeys, isLoading: journeysLoading, error: journeysError } = useActiveJourneys(routeId);

  const [account, setAccount] = useState<AccountSession | null>(() => loadAccountSession());
  const [contributorSession, setContributorSession] = useState<ContributorSession | null>(() => loadSession());
  const [boardingBusy, setBoardingBusy] = useState(false);
  const [boardingError, setBoardingError] = useState<string | null>(null);
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

  // The sheet starts open where there is room beside the map and closed on a
  // phone, where an open sheet would be most of the screen.
  const [isSheetExpanded, setSheetExpanded] = useState(hasRoomForPanel);
  const [isCatalogueOpen, setCatalogueOpen] = useState(false);
  const catalogueRef = useRef<HTMLDetailsElement | null>(null);

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
    // A shareable link carries the stop, and nothing else. Capabilities never
    // appear in a URL.
    const next = new URLSearchParams(searchParams);
    next.set('stop', stopId);
    setSearchParams(next, { replace: true });
  };

  const state = snapshot?.state ?? null;
  const mode: JourneyMode = projected?.mode ?? state?.mode ?? 'PENDING';
  // Memoised because the map re-reads this list whenever its identity changes,
  // and the placeholder rows would otherwise be a new array on every frame.
  const stops: readonly StopEta[] = useMemo(
    () => state?.stops ?? emptyStops(route),
    [state, route],
  );
  const selectedStop = stops.find((s) => s.stopId === selectedStopId) ?? null;
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

  // Announce only the transitions that change what a person should do — not
  // every second and not every coordinate.
  const announcement = useAnnouncement(mode, activeJourneyId);

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
      setBoardingError(
        caught instanceof ApiError ? caught.message : 'Could not reach the API.',
      );
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
        <main className="page">
          <p className="muted">{en.common.loading}</p>
        </main>
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

  const noJourney = activeJourneyId === null;
  return (
    <>
      <Header routeCode={route.dto.code} routeDirection={`${route.dto.origin} → ${route.dto.destination}`} />
      <main className="route-page">
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

      <div className="route-page__top">
        <JourneyStatus
          mode={mode}
          ageSeconds={projected?.ageSeconds ?? state?.lastFixAgeSeconds ?? null}
          hasJourney={!noJourney}
          isReconnecting={isReconnecting}
        />
      </div>

      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>

      <JourneySheet
        routeCode={route.dto.code}
        routeDirection={`${route.dto.origin} → ${route.dto.destination}`}
        isDemo={state?.isDemo ?? false}
        isExpanded={isSheetExpanded}
        onToggle={() => setSheetExpanded((open) => !open)}
        summary={
          noJourney ? (
            <div className="journey-sheet__empty">
              <div>
                <h2>{journeysLoading ? en.common.loading : en.journeys.none}</h2>
                {journeysLoading ? null : <p className="meta">{en.journeys.noneHelp}</p>}
              </div>
              {journeysLoading ? null : (
                <Link to={site.drivePath} className="button button--secondary">
                  {en.header.contributeLink}
                </Link>
              )}
            </div>
          ) : (
            <ArrivalPanel
              stop={selectedStop}
              mode={mode}
              confidenceM={state?.confidenceM ?? null}
              offRoute={state?.offRoute ?? false}
            />
          )
        }
      >
        {journeysError ? (
          <div className="journey-sheet__section">
            <p className="notice notice--warning">{en.journeys.listUnavailable}</p>
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

        <StopList
          route={route.dto}
          stops={stops}
          selectedStopId={selectedStopId}
          onSelect={selectStop}
        />

        <details
          ref={catalogueRef}
          className="journey-sheet__section route-page__directory"
          open={isCatalogueOpen}
          onToggle={(event) => setCatalogueOpen(event.currentTarget.open)}
        >
          <summary>{en.nav.routes}</summary>
          <RouteSwitcher routes={routeDirectory.routes} currentRouteId={routeId} compact />
        </details>

        <div className="journey-sheet__section">
          <RouteDetails route={route.dto} />
        </div>
      </JourneySheet>
      </main>
    </>
  );
}

/** Wide enough for a drawer beside the map rather than a sheet over it. */
function hasRoomForPanel(): boolean {
  return window.matchMedia('(min-width: 900px)').matches;
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

function useAnnouncement(mode: JourneyMode, journeyId: string | null): string {
  const previous = useRef<JourneyMode | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (journeyId === null) {
      previous.current = null;
      return;
    }
    if (previous.current !== null && previous.current !== mode) {
      switch (mode) {
        case 'ESTIMATED':
          setMessage(en.freshness.estimated);
          break;
        case 'STALE':
          setMessage(en.freshness.staleMessage);
          break;
        case 'LIVE':
          setMessage(en.freshness.live);
          break;
        case 'ENDED':
          setMessage(en.journeys.ended);
          break;
        default:
          setMessage('');
      }
    }
    previous.current = mode;
  }, [mode, journeyId]);

  return message;
}
