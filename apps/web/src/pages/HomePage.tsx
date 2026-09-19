import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RouteStop } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import { useRoute } from '../hooks/useRoute.js';
import { useRoutes } from '../hooks/useRoutes.js';
import { site } from '../config/site.js';
import './home-page.css';

type PickerTarget = 'nearest' | 'from' | 'to';

export function HomePage() {
  const navigate = useNavigate();
  const directory = useRoutes();
  const { route } = useRoute(site.defaultRouteId);
  const stops = route?.dto.stops ?? [];
  const [selectedStopId, setSelectedStopId] = useState<string | null>(stops[0]?.id ?? null);
  const [fromId, setFromId] = useState<string | null>(stops[0]?.id ?? null);
  const [toId, setToId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [search, setSearch] = useState('');
  const [routeSearch, setRouteSearch] = useState('');
  const [locating, setLocating] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  useEffect(() => {
    const first = stops[0];
    if (!first) return;
    setSelectedStopId((current) => current ?? first.id);
    setFromId((current) => current ?? first.id);
  }, [stops]);

  const selectedStop = stopById(stops, selectedStopId) ?? stops[0] ?? null;
  const shownRoutes = directory.routes.filter((item) =>
    `${item.code} ${item.name}`.toLocaleLowerCase().includes(routeSearch.toLocaleLowerCase()),
  );
  const shownStops = useMemo(
    () => stops.filter((stop) => stop.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
    [search, stops],
  );

  const chooseStop = (stop: RouteStop) => {
    if (picker === 'to') setToId(stop.id);
    else if (picker === 'from') setFromId(stop.id);
    else {
      setSelectedStopId(stop.id);
      setFromId(stop.id);
    }
    setPicker(null);
    setSearch('');
  };

  const locate = () => {
    if (!navigator.geolocation || stops.length === 0) {
      setPicker('nearest');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nearest = [...stops].sort((a, b) =>
          squaredDistance(a, position.coords) - squaredDistance(b, position.coords),
        )[0];
        if (nearest) {
          setSelectedStopId(nearest.id);
          setFromId(nearest.id);
        }
        setLocating(false);
      },
      () => {
        setLocating(false);
        setPicker('nearest');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const findBuses = () => {
    if (!route || !fromId || !toId) {
      setResultMessage('Choose both stops to find a bus.');
      return;
    }
    const fromIndex = route.dto.stops.findIndex((stop) => stop.id === fromId);
    const toIndex = route.dto.stops.findIndex((stop) => stop.id === toId);
    if (fromIndex < 0 || toIndex <= fromIndex) {
      setResultMessage('No direct outbound route is available between those stops yet.');
      return;
    }
    navigate(`/r/${route.dto.id}?stop=${encodeURIComponent(fromId)}`);
  };

  return (
    <>
      <Header />
      <main className="home-screen">
        <div className="home-screen__wrap">
          <section className="stop-selector" aria-labelledby="nearest-stop">
            <span className={`location-status${locating ? ' is-locating' : ''}`}>
              <span className="pip" />{locating ? 'Finding your nearest stop…' : 'Nearest tracked stop to you'}
            </span>
            <h1 className="stop-name" id="nearest-stop">{selectedStop?.name ?? 'Choose a stop'}</h1>
            <p className="stop-meta">AC24 corridor · Kolkata</p>
            <div className="stop-actions">
              <button className="button button--secondary" type="button" onClick={locate}>Use my location</button>
              <button className="button button--secondary" type="button" onClick={() => setPicker('nearest')}>Change stop</button>
            </div>
          </section>

          <p className="spine-ask">How do you want to find your bus?</p>
          <div className="spine" aria-hidden="true"><i /><b><span /></b><i /></div>

          <div className="home-paths">
            <section className="path-card">
              <h2>I know where I’m going</h2>
              <p>Pick two stops and see every tracked bus that runs between them.</p>
              <div className="path-card__fields">
                <button type="button" className="journey-field" onClick={() => setPicker('from')}>
                  <span className="journey-field__pin">A</span><span><small>From</small><b>{stopById(stops, fromId)?.name ?? 'Choose a stop'}</b></span>
                </button>
                <button type="button" className="journey-field" onClick={() => setPicker('to')}>
                  <span className="journey-field__pin is-end">B</span><span><small>To</small><b>{stopById(stops, toId)?.name ?? 'Choose a stop'}</b></span>
                </button>
              </div>
              <button className="button home-screen__primary" type="button" onClick={findBuses}>Find buses</button>
              {resultMessage ? <p className="home-screen__message">{resultMessage}</p> : null}
            </section>

            <section className="path-card">
              <h2>I know which bus I want</h2>
              <p>Pick a route and we’ll show its live position and arrival times.</p>
              <input className="home-search" value={routeSearch} onChange={(event) => setRouteSearch(event.target.value)} placeholder="Route number, e.g. AC24" aria-label="Search route number" />
              <div className="route-chips">
                {shownRoutes.map((item) => (
                  <button key={item.id} type="button" disabled={!item.trackingAvailable} onClick={() => navigate(`/r/${item.id}${selectedStop ? `?stop=${encodeURIComponent(selectedStop.id)}` : ''}`)}>
                    {item.code}
                  </button>
                ))}
              </div>
              <p className="path-card__hint">{shownRoutes.filter((item) => item.trackingAvailable).length} route with map geometry is ready to track.</p>
            </section>
          </div>
        </div>
      </main>

      {picker ? (
        <div className="stop-picker" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPicker(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="stop-picker-title">
            <header>
              <h2 id="stop-picker-title">{picker === 'to' ? 'Where are you going?' : picker === 'from' ? 'Where are you starting?' : 'Choose your stop'}</h2>
              <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} className="home-search" placeholder="Type a stop name" />
            </header>
            <div className="stop-picker__list">
              {shownStops.map((stop) => <button key={stop.id} type="button" onClick={() => chooseStop(stop)}><i /><span><b>{stop.name}</b><small>AC24 corridor</small></span></button>)}
            </div>
            <footer><button className="button button--secondary" type="button" onClick={() => setPicker(null)}>Cancel</button></footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function stopById(stops: readonly RouteStop[], id: string | null): RouteStop | null {
  return stops.find((stop) => stop.id === id) ?? null;
}

function squaredDistance(stop: RouteStop, coords: GeolocationCoordinates): number {
  const lat = stop.lat - coords.latitude;
  const lon = (stop.lon - coords.longitude) * Math.cos((stop.lat * Math.PI) / 180);
  return lat * lat + lon * lon;
}
