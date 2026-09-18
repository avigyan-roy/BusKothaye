import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { positionAt, type JourneyMode, type StopEta } from '@buskothay/shared';
import { Header, DemoBadge } from '../components/Header.js';
import { MapView } from '../features/map/MapView.js';
import { ArrivalPanel } from '../features/journeys/ArrivalPanel.js';
import { StopList } from '../features/journeys/StopList.js';
import { RouteDetails } from '../features/journeys/RouteDetails.js';
import { JourneySelector } from '../features/journeys/JourneySelector.js';
import { useRoute } from '../hooks/useRoute.js';
import { preferredJourney, useActiveJourneys } from '../hooks/useActiveJourneys.js';
import { useJourneyState } from '../hooks/useJourneyState.js';
import { useProjectedJourney } from '../hooks/useProjectedJourney.js';
import { loadPreferredStop, savePreferredStop } from '../lib/session.js';
import { site } from '../config/site.js';
import { en } from '../content/en.js';
import './route-page.css';

/**
 * The passenger screen: a useful map and an arrival time, straight away.
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
  const { journeys, isLoading: journeysLoading } = useActiveJourneys(routeId);

  const [chosenJourneyId, setChosenJourneyId] = useState<string | null>(null);
  const activeJourneyId = useMemo(() => {
    if (chosenJourneyId !== null && journeys.some((j) => j.journeyId === chosenJourneyId)) {
      return chosenJourneyId;
    }
    return preferredJourney(journeys)?.journeyId ?? null;
  }, [chosenJourneyId, journeys]);

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
    // A shareable link carries the stop, and nothing else. Capabilities never
    // appear in a URL.
    const next = new URLSearchParams(searchParams);
    next.set('stop', stopId);
    setSearchParams(next, { replace: true });
  };

  const state = snapshot?.state ?? null;
  const mode: JourneyMode = projected?.mode ?? state?.mode ?? 'PENDING';
  const stops: readonly StopEta[] = state?.stops ?? emptyStops(route);
  const selectedStop = stops.find((s) => s.stopId === selectedStopId) ?? null;

  const busPosition = useMemo(() => {
    if (route === null || projected?.sM == null) return null;
    if (mode === 'PENDING') return null;
    return positionAt(route, projected.sM);
  }, [route, projected?.sM, mode]);

  // Announce only the transitions that change what a person should do — not
  // every second and not every coordinate.
  const announcement = useAnnouncement(mode, activeJourneyId);

  if (routeLoading) {
    return (
      <>
        <Header />
        <main className="page">
          <p>{en.common.loading}</p>
        </main>
      </>
    );
  }

  if (routeError !== null || route === null) {
    return (
      <>
        <Header />
        <main className="page stack">
          <h1>{en.errors.routeUnavailable}</h1>
          <button type="button" className="button" onClick={reload}>
            {en.common.retry}
          </button>
        </main>
      </>
    );
  }

  const noJourney = activeJourneyId === null;

  return (
    <>
      <Header
        routeCode={route.dto.code}
        routeDirection={`${route.dto.origin} → ${route.dto.destination}`}
        action={{ label: en.header.contributeLink, to: site.drivePath }}
      />

      <main className="route-page">
        <div className="route-page__map">
          <MapView
            route={route.dto}
            selectedStopId={selectedStopId}
            onSelectStop={selectStop}
            bus={busPosition}
            busMode={mode}
            confidenceM={state?.confidenceM ?? null}
            isDemo={state?.isDemo ?? false}
          />
        </div>

        <div className="route-page__panel">
          <p aria-live="polite" className="visually-hidden">
            {announcement}
          </p>

          {noJourney ? (
            <section className="route-page__empty">
              <h2>{journeysLoading ? en.common.loading : en.journeys.none}</h2>
              {journeysLoading ? null : <p className="muted">{en.journeys.noneHelp}</p>}
              <Link to={site.drivePath} className="button">
                {en.header.contributeLink}
              </Link>
            </section>
          ) : (
            <>
              {state?.isDemo ? (
                <p className="route-page__demo">
                  <DemoBadge /> <span className="muted">{en.common.demoJourney}</span>
                </p>
              ) : null}

              <ArrivalPanel
                stop={selectedStop}
                mode={mode}
                ageSeconds={projected?.ageSeconds ?? state?.lastFixAgeSeconds ?? null}
                confidenceM={state?.confidenceM ?? null}
                offRoute={state?.offRoute ?? false}
                isReconnecting={isReconnecting}
                onChangeStop={() => {
                  document.getElementById('stop-list-heading')?.scrollIntoView({
                    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                      ? 'auto'
                      : 'smooth',
                    block: 'start',
                  });
                }}
              />
            </>
          )}

          <JourneySelector
            journeys={journeys}
            selectedId={activeJourneyId}
            onSelect={setChosenJourneyId}
          />

          <StopList
            route={route.dto}
            stops={stops}
            selectedStopId={selectedStopId}
            onSelect={selectStop}
          />

          <div className="route-page__details">
            <RouteDetails route={route.dto} />
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
