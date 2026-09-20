import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DirectoryStop, RouteSummary } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import { StopPicker } from '../features/passenger/StopPicker.js';
import { useStopDirectory } from '../hooks/useStopDirectory.js';
import { useRoutes } from '../hooks/useRoutes.js';
import { en } from '../content/en.js';
import './home-page.css';

type PickerTarget = 'mine' | 'from' | 'to';

/**
 * "Where are you, and how do you want to find your bus?"
 *
 * Two paths, because there are two kinds of passenger: one who knows the
 * journey and not the bus, and one who knows the bus and wants a time. Both
 * start from the same stop, which is why the stop selector sits above the fork
 * rather than inside either branch.
 *
 * Everything on this screen — stops, route numbers, which routes can be tracked
 * — comes from the server. Nothing about any particular city or route is
 * written here.
 */
export function HomePage() {
  const navigate = useNavigate();
  const directory = useStopDirectory();
  const routes = useRoutes();

  const [fromKey, setFromKey] = useState<string | null>(null);
  const [toKey, setToKey] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [routeQuery, setRouteQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // The journey's starting point defaults to the passenger's own stop, and stops
  // following it the moment they choose something else.
  const from = byKey(directory.stops, fromKey) ?? directory.selected;
  const to = byKey(directory.stops, toKey);

  const routeGroups = useMemo(() => groupByCode(routes.routes), [routes.routes]);
  const shownRoutes = useMemo(() => {
    const needle = routeQuery.trim().toLocaleLowerCase();
    if (needle.length === 0) return routeGroups;
    return routeGroups.filter((group) =>
      `${group.code} ${group.directions.map((route) => route.name).join(' ')}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [routeGroups, routeQuery]);
  const trackedCount = routeGroups.filter((group) => group.trackingAvailable).length;

  const choose = (stop: DirectoryStop) => {
    if (picker === 'to') setToKey(stop.key);
    else if (picker === 'from') setFromKey(stop.key);
    else {
      directory.select(stop.key);
      setFromKey(null);
    }
    setPicker(null);
    setMessage(null);
  };

  const findBuses = () => {
    if (from === null || to === null) {
      setMessage(en.find.chooseBothStops);
      return;
    }
    if (from.key === to.key) {
      setMessage(en.find.sameStop);
      return;
    }
    navigate(`/find?from=${encodeURIComponent(from.key)}&to=${encodeURIComponent(to.key)}`);
  };

  const openRoute = (code: string) => {
    if (directory.selected === null) {
      setMessage(en.find.pickStopFirst);
      setPicker('mine');
      return;
    }
    navigate(`/bus/${encodeURIComponent(code)}?stop=${encodeURIComponent(directory.selected.key)}`);
  };

  return (
    <>
      <Header />
      <main className="home-screen">
        <div className="home-screen__wrap">
          <section className="stop-selector" aria-labelledby="my-stop">
            <span className={`location-status is-${directory.locating}`}>
              <span className="pip" />
              {directory.locating === 'locating'
                ? en.find.locating
                : directory.locating === 'unavailable'
                  ? en.find.locationUnavailable
                  : en.find.nearestStop}
            </span>
            <h1 className="stop-name" id="my-stop">
              {directory.selected?.name ?? (directory.isLoading ? en.common.loading : en.find.noStopYet)}
            </h1>
            <p className="stop-meta">{stopMeta(directory.selected)}</p>
            <div className="stop-actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={directory.locate}
                disabled={directory.stops.length === 0}
              >
                {en.find.useLocation}
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setPicker('mine')}
                disabled={directory.stops.length === 0}
              >
                {directory.selected === null ? en.find.chooseStop : en.find.changeStop}
              </button>
            </div>
            {directory.error === null ? null : (
              <p className="notice notice--warning home-screen__error">
                {en.errors.routeUnavailable}{' '}
                <button className="back-btn" type="button" onClick={directory.reload}>
                  {en.common.retry}
                </button>
              </p>
            )}
          </section>

          <p className="spine-ask">{en.find.ask}</p>
          <div className="spine" aria-hidden="true"><i /><b><span /></b><i /></div>

          <div className="home-paths">
            <section className="path-card" aria-labelledby="path-a">
              <h2 id="path-a">{en.find.pathATitle}</h2>
              <p>{en.find.pathABody}</p>
              <div className="path-card__fields">
                <button
                  type="button"
                  className="journey-field"
                  onClick={() => setPicker('from')}
                  disabled={directory.stops.length === 0}
                >
                  <span className="journey-field__pin">A</span>
                  <span>
                    <small>{en.find.from}</small>
                    <b>{from?.name ?? en.find.chooseStop}</b>
                  </span>
                </button>
                <button
                  type="button"
                  className="journey-field"
                  onClick={() => setPicker('to')}
                  disabled={directory.stops.length === 0}
                >
                  <span className="journey-field__pin is-end">B</span>
                  <span>
                    <small>{en.find.to}</small>
                    <b>{to?.name ?? en.find.chooseStop}</b>
                  </span>
                </button>
              </div>
              <button className="button home-screen__primary" type="button" onClick={findBuses}>
                {en.find.findBuses}
              </button>
              {message === null ? null : <p className="home-screen__message">{message}</p>}
            </section>

            <section className="path-card" aria-labelledby="path-b">
              <h2 id="path-b">{en.find.pathBTitle}</h2>
              <p>{en.find.pathBBody}</p>
              <input
                className="home-search"
                value={routeQuery}
                onChange={(event) => setRouteQuery(event.target.value.slice(0, 40))}
                placeholder={en.find.routeSearchPlaceholder}
                aria-label={en.find.routeSearchLabel}
              />
              <div className="route-chips">
                {shownRoutes.map((group) => (
                  <button
                    key={group.code}
                    type="button"
                    disabled={!group.trackingAvailable}
                    title={group.trackingAvailable ? undefined : group.missing ?? undefined}
                    onClick={() => openRoute(group.code)}
                  >
                    {group.code}
                  </button>
                ))}
              </div>
              <p className="path-card__hint">
                {routes.isLoading
                  ? en.common.loading
                  : trackedCount === 0
                    ? en.find.noTrackedRoutes
                    : en.find.trackedRouteCount(trackedCount)}
              </p>
            </section>
          </div>
        </div>
      </main>

      {picker === null ? null : (
        <StopPicker
          title={
            picker === 'to'
              ? en.find.to
              : picker === 'from'
                ? en.find.from
                : en.find.chooseStop
          }
          stops={directory.stops}
          onChoose={choose}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

export interface RouteGroup {
  readonly code: string;
  readonly directions: readonly RouteSummary[];
  readonly trackingAvailable: boolean;
  readonly missing: string | null;
}

/**
 * One chip per route number.
 *
 * A route in this data model is a number *and* a direction, so "AC24" is two
 * records. A passenger asking for AC24 has not yet said which way they are
 * going, so the directions are collapsed here and offered as the next question.
 */
export function groupByCode(routes: readonly RouteSummary[]): RouteGroup[] {
  const groups = new Map<string, RouteSummary[]>();
  for (const route of routes) {
    const existing = groups.get(route.code);
    if (existing) existing.push(route);
    else groups.set(route.code, [route]);
  }
  return [...groups.entries()]
    .map(([code, directions]) => ({
      code,
      directions,
      trackingAvailable: directions.some((route) => route.trackingAvailable),
      missing: directions.find((route) => route.missing !== null)?.missing ?? null,
    }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

function byKey(stops: readonly DirectoryStop[], key: string | null): DirectoryStop | null {
  if (key === null) return null;
  return stops.find((stop) => stop.key === key) ?? null;
}

/** "AC24, AC30" — what actually calls here. Never a city or corridor name. */
function stopMeta(stop: DirectoryStop | null): string {
  if (stop === null) return '';
  const codes = [...new Set(stop.routes.map((route) => route.code))];
  return `${codes.join(' · ')}`;
}
