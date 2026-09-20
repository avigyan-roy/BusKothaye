import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Arrival, RouteSummary } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import { ArrivalClock } from '../features/passenger/ArrivalClock.js';
import { LiveStatus } from '../features/passenger/LiveStatus.js';
import { StopPicker } from '../features/passenger/StopPicker.js';
import { useArrivals } from '../hooks/useArrivals.js';
import { useNow } from '../hooks/useNow.js';
import { useRoutes } from '../hooks/useRoutes.js';
import { useStopDirectory } from '../hooks/useStopDirectory.js';
import { en } from '../content/en.js';
import './results-page.css';

/**
 * Path B: one route number, one direction, one arrival time.
 *
 * A route here is a number *and* a direction, so "AC24" names two records and
 * the direction is a real question rather than a nicety — the same stop has a
 * completely different answer depending on which way the bus is going. Both the
 * direction and the stop are in the URL, so back, forward and refresh all land
 * exactly where the passenger left off.
 */
export function BusPage() {
  const { code = '' } = useParams<{ code: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const directory = useStopDirectory();
  const routes = useRoutes();
  const nowMs = useNow();
  const [picking, setPicking] = useState(false);

  // The URL wins over the remembered stop, so a shared link shows what it says.
  const stopKey = params.get('stop') ?? directory.selected?.key ?? null;
  const routeId = params.get('dir');
  const stop = useMemo(
    () => directory.stops.find((candidate) => candidate.key === stopKey) ?? null,
    [directory.stops, stopKey],
  );

  const directions = useMemo(
    () => routes.routes.filter((route) => route.code === code && route.trackingAvailable),
    [routes.routes, code],
  );
  const chosen = directions.find((route) => route.id === routeId) ?? null;

  const { data, isLoading } = useArrivals(chosen === null ? null : stopKey, {
    routeId: chosen?.id ?? null,
  });
  const arrival = data?.arrivals[0] ?? null;

  const setStop = (key: string) => {
    directory.select(key);
    const next = new URLSearchParams(params);
    next.set('stop', key);
    setParams(next, { replace: true });
    setPicking(false);
  };

  return (
    <>
      <Header />
      <main className="results-screen">
        <div className="results-screen__wrap">
          <div className="crumb">
            {chosen === null ? (
              <Link className="back-btn" to="/">← {en.common.back}</Link>
            ) : (
              <button
                className="back-btn"
                type="button"
                onClick={() => navigate(-1)}
              >
                ← {en.find.directionQuestion}
              </button>
            )}
          </div>

          {routes.isLoading ? (
            <p className="muted">{en.common.loading}</p>
          ) : directions.length === 0 ? (
            <div className="empty-state">
              <h3>{en.errors.geometryUnavailable}</h3>
              <p>{en.errors.geometryUnavailableHelp}</p>
              <Link className="button" to="/">{en.errors.goToRoute}</Link>
            </div>
          ) : chosen === null ? (
            <DirectionPicker code={code} directions={directions} stopKey={stopKey} />
          ) : (
            <Answer
              code={code}
              route={chosen}
              arrival={arrival}
              stopName={stop?.name ?? data?.from.name ?? null}
              isLoading={isLoading}
              nowMs={nowMs}
              onChangeStop={() => setPicking(true)}
            />
          )}
        </div>
      </main>

      {picking ? (
        <StopPicker
          title={en.find.chooseStop}
          stops={directory.stops}
          onChoose={(next) => setStop(next.key)}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}

function DirectionPicker({
  code,
  directions,
  stopKey,
}: {
  code: string;
  directions: readonly RouteSummary[];
  stopKey: string | null;
}) {
  const suffix = stopKey === null ? '' : `&stop=${encodeURIComponent(stopKey)}`;
  return (
    <div className="picker-panel">
      <div className="answer-head">
        <span className="route-badge">{code}</span>
        <span className="answer-dest">{directions[0]?.name ?? code}</span>
      </div>
      <h1 style={{ marginTop: 18, fontSize: 24 }}>{en.find.directionQuestion}</h1>
      <p className="journey-sub">
        {directions.length === 1 ? en.find.onlyOneDirection : en.find.directionHelp}
      </p>
      <div className="direction-list">
        {directions.map((route) => (
          <Link
            key={route.id}
            className="direction-option"
            to={`/bus/${encodeURIComponent(code)}?dir=${encodeURIComponent(route.id)}${suffix}`}
          >
            <span className="direction-option__arrow" aria-hidden="true">
              {route.direction === 'outbound' ? '↑' : '↓'}
            </span>
            <span>
              <span className="direction-option__main">{en.find.towards(route.destination)}</span>
              <span className="direction-option__sub">{en.find.startsAt(route.origin)}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Answer({
  code,
  route,
  arrival,
  stopName,
  isLoading,
  nowMs,
  onChangeStop,
}: {
  code: string;
  route: RouteSummary;
  arrival: Arrival | null;
  stopName: string | null;
  isLoading: boolean;
  nowMs: number;
  onChangeStop: () => void;
}) {
  if (isLoading && arrival === null) {
    return <p className="muted">{en.common.loading}</p>;
  }

  // The route is tracked and the stop exists, but this direction never calls
  // there — which is a real answer, and a different one from "no bus right now".
  if (arrival === null) {
    return (
      <div className="answer-card">
        <div className="answer-head">
          <span className="route-badge">{code}</span>
          <span className="answer-dest">{en.find.towards(route.destination)}</span>
        </div>
        <h2 style={{ marginTop: 20 }}>
          {en.find.routeDoesNotStop(code, stopName ?? en.find.chooseStop)}
        </h2>
        <p className="journey-sub" style={{ marginTop: 8 }}>
          {en.find.routeDoesNotStopHelp(route.origin)}
        </p>
        <div className="answer-card__foot">
          <button className="button button--secondary" type="button" onClick={onChangeStop}>
            {en.find.changeMyStop}
          </button>
        </div>
      </div>
    );
  }

  const detailsHref =
    `/r/${encodeURIComponent(arrival.routeId)}?stop=${encodeURIComponent(arrival.boardStopId)}`;

  return (
    <div className="answer-card">
      <div className="answer-head">
        <span className="route-badge">{arrival.code}</span>
        <span className="answer-dest">{en.find.towards(arrival.destination)}</span>
      </div>

      <p className="answer-card__stop-label">{en.find.arrivingAt(arrival.boardStopName)}</p>
      <p className="answer-card__stop">{arrival.boardStopName}</p>

      <div className="answer-card__eta">
        <ArrivalClock stop={arrival.arrival} mode={arrival.mode} size="hero" nowMs={nowMs} />
      </div>

      <div className="answer-card__live">
        <LiveStatus mode={arrival.mode} ageSeconds={arrival.lastFixAgeSeconds} />
        {arrival.currentStopName === null ? null : (
          <span className="journey-sub">
            {en.find.nearStop(arrival.currentStopName)}
            {arrival.stopsAway === null ? '' : ` · ${en.find.stopsBefore(arrival.stopsAway)}`}
          </span>
        )}
      </div>

      <div className="answer-card__foot">
        <Link className="button" to={detailsHref}>{en.find.details}</Link>
        <button className="button button--secondary" type="button" onClick={onChangeStop}>
          {en.find.changeMyStop}
        </button>
      </div>
    </div>
  );
}
