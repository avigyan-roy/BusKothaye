import { useEffect, useRef, useState } from 'react';
import type { JourneyMode, RouteDto, StopEta } from '@buskothay/shared';
import { MapControlButton, icons } from '../../components/MapControlButton.js';
import { en } from '../../content/en.js';
import { webConfig } from '../../lib/api.js';
import { loadGoogleMapLibraries } from './googleMaps.js';
import './map-view.css';

export interface MapViewProps {
  readonly route: RouteDto;
  readonly stops: readonly StopEta[];
  readonly selectedStopId: string | null;
  readonly onSelectStop: (stopId: string) => void;
  readonly bus: { lat: number; lon: number } | null;
  readonly busMode: JourneyMode;
  readonly confidenceM: number | null;
  readonly isDemo: boolean;
}

type Libraries = Awaited<ReturnType<typeof loadGoogleMapLibraries>>;

export function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const librariesRef = useRef<Libraries | null>(null);
  const routeLineRef = useRef<google.maps.Polyline | null>(null);
  const stopMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const busMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const confidenceRef = useRef<google.maps.Circle | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing-key' | 'failed'>('loading');
  const [followBus, setFollowBus] = useState(false);
  const [locationState, setLocationState] = useState<'idle' | 'locating' | 'failed'>('idle');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    setStatus('loading');

    void loadGoogleMapLibraries(webConfig)
      .then((libraries) => {
        if (cancelled) return;
        librariesRef.current = libraries;
        const map = new libraries.maps.Map(container, {
          center: centreOf(props.route),
          zoom: 12,
          mapId: webConfig.googleMapsMapId,
          colorScheme: libraries.core.ColorScheme.DARK,
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          keyboardShortcuts: true,
        });
        mapRef.current = map;
        routeLineRef.current = new google.maps.Polyline({
          map,
          path: routePath(props.route),
          strokeColor: props.route.color,
          strokeOpacity: 1,
          strokeWeight: 6,
          clickable: false,
          zIndex: 10,
        });
        new google.maps.TrafficLayer({ autoRefresh: true }).setMap(map);
        fitToRoute(map, props.route);
        map.addListener('dragstart', () => setFollowBus(false));
        map.addListener('zoom_changed', () => setFollowBus(false));
        resizeObserver = new ResizeObserver(() => fitToRoute(map, props.route));
        resizeObserver.observe(container);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus(error instanceof Error && error.message === 'GOOGLE_MAPS_KEY_MISSING' ? 'missing-key' : 'failed');
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      clearMarkers(stopMarkersRef.current);
      stopMarkersRef.current = [];
      if (busMarkerRef.current) busMarkerRef.current.map = null;
      if (userMarkerRef.current) userMarkerRef.current.map = null;
      confidenceRef.current?.setMap(null);
      routeLineRef.current?.setMap(null);
      mapRef.current = null;
      librariesRef.current = null;
    };
    // Recreate only when the immutable route version changes or after retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.route.id, props.route.version, retryKey]);

  useEffect(() => {
    const map = mapRef.current;
    const libraries = librariesRef.current;
    if (!map || !libraries || status !== 'ready') return;
    clearMarkers(stopMarkersRef.current);
    const stateByStop = new Map(props.stops.map((stop) => [stop.stopId, stop.status]));
    stopMarkersRef.current = props.route.stops.map((stop) => {
      const selected = stop.id === props.selectedStopId;
      const content = document.createElement('button');
      content.type = 'button';
      content.className = `google-stop google-stop--${stateByStop.get(stop.id) ?? 'upcoming'}${selected ? ' google-stop--selected' : ''}`;
      content.title = stop.name;
      content.setAttribute('aria-label', `Select ${stop.name}`);
      content.innerHTML = `<span></span><b>${escapeHtml(stop.name)}</b>`;
      content.addEventListener('click', () => props.onSelectStop(stop.id));
      return new libraries.marker.AdvancedMarkerElement({
        map,
        position: { lat: stop.lat, lng: stop.lon },
        title: stop.name,
        content,
        zIndex: selected ? 40 : 20,
      });
    });
  }, [props.route, props.stops, props.selectedStopId, props.onSelectStop, status]);

  useEffect(() => {
    const map = mapRef.current;
    const libraries = librariesRef.current;
    if (!map || !libraries || status !== 'ready') return;
    if (!props.bus) {
      if (busMarkerRef.current) busMarkerRef.current.map = null;
      busMarkerRef.current = null;
      confidenceRef.current?.setMap(null);
      return;
    }
    const position = { lat: props.bus.lat, lng: props.bus.lon };
    if (!busMarkerRef.current) {
      const content = document.createElement('div');
      content.className = busClass(props.busMode, props.isDemo);
      content.title = props.isDemo ? 'Demo bus' : 'Bus position';
      content.innerHTML = '<span aria-hidden="true">▰</span>';
      busMarkerRef.current = new libraries.marker.AdvancedMarkerElement({
        map,
        position,
        title: content.title,
        content,
        zIndex: 80,
      });
    } else {
      busMarkerRef.current.position = position;
      busMarkerRef.current.map = map;
      const content = busMarkerRef.current.content;
      if (content instanceof HTMLElement) content.className = busClass(props.busMode, props.isDemo);
    }
    if (followBus) map.panTo(position);

    const showConfidence =
      props.confidenceM !== null && (props.busMode === 'ESTIMATED' || props.busMode === 'STALE');
    if (!showConfidence) {
      confidenceRef.current?.setMap(null);
      return;
    }
    confidenceRef.current ??= new google.maps.Circle({
      strokeColor: '#FFC42E',
      strokeOpacity: 0.9,
      strokeWeight: 1,
      fillColor: '#FFC42E',
      fillOpacity: 0.12,
      clickable: false,
      zIndex: 5,
    });
    confidenceRef.current.setOptions({ map, center: position, radius: props.confidenceM ?? 0 });
  }, [props.bus, props.busMode, props.confidenceM, props.isDemo, followBus, status]);

  const locate = () => {
    if (!navigator.geolocation) {
      setLocationState('failed');
      return;
    }
    setLocationState('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationState('idle');
        const map = mapRef.current;
        const libraries = librariesRef.current;
        if (!map || !libraries) return;
        const location = { lat: position.coords.latitude, lng: position.coords.longitude };
        const dot = document.createElement('div');
        dot.className = 'google-user';
        if (userMarkerRef.current) userMarkerRef.current.map = null;
        userMarkerRef.current = new libraries.marker.AdvancedMarkerElement({
          map,
          position: location,
          title: 'Your location',
          content: dot,
          zIndex: 70,
        });
        setFollowBus(false);
        map.panTo(location);
        map.setZoom(Math.max(map.getZoom() ?? 14, 14));
      },
      () => setLocationState('failed'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-view__canvas" aria-label="Google map of the bus route" />
      {status !== 'ready' ? (
        <div className="map-view__fallback" role="status">
          <strong>{status === 'loading' ? 'Loading Google Maps…' : 'Google Maps is not configured'}</strong>
          <span>
            {status === 'missing-key'
              ? 'Add VITE_GOOGLE_MAPS_API_KEY to apps/web/.env.local.'
              : status === 'failed'
                ? 'The map service could not be reached.'
                : 'Route and live arrival details remain available.'}
          </span>
          {status === 'failed' ? (
            <button className="button button--secondary" type="button" onClick={() => setRetryKey((key) => key + 1)}>{en.common.retry}</button>
          ) : null}
        </div>
      ) : null}

      <div className="map-view__legend" aria-label="Map legend">
        <span><i className="is-passed" />Passed</span>
        <span><i className="is-live" />Live</span>
        <span><i className="is-ahead" />To come</span>
      </div>
      <div className="map-view__actions">
        <MapControlButton label={en.route.showRoute} icon={icons.wholeRoute} onClick={() => {
          const map = mapRef.current;
          if (map) fitToRoute(map, props.route);
        }} />
        {props.bus ? (
          <MapControlButton label={followBus ? en.route.stopFollowing : en.route.followBus} icon={icons.followBus} isActive={followBus} onClick={() => {
            setFollowBus((value) => !value);
            if (!followBus && props.bus) mapRef.current?.panTo({ lat: props.bus.lat, lng: props.bus.lon });
          }} />
        ) : null}
        <MapControlButton label={locationState === 'locating' ? en.map.locating : en.route.locateMe} icon={icons.locate} isBusy={locationState === 'locating'} onClick={locate} />
      </div>
      {locationState === 'failed' ? <p className="map-view__notice">Location is unavailable. Check browser permission and try again.</p> : null}
      <div className="map-view__provider">Google Maps · live traffic</div>
    </div>
  );
}

function routePath(route: RouteDto): google.maps.LatLngLiteral[] {
  return route.geometry.coordinates.map(([lon, lat]) => ({ lat, lng: lon }));
}

function centreOf(route: RouteDto): google.maps.LatLngLiteral {
  const points = routePath(route);
  return points[Math.floor(points.length / 2)] ?? { lat: 22.5726, lng: 88.3639 };
}

function fitToRoute(map: google.maps.Map, route: RouteDto): void {
  const bounds = new google.maps.LatLngBounds();
  for (const point of routePath(route)) bounds.extend(point);
  map.fitBounds(bounds, { top: 74, right: 72, bottom: 170, left: 56 });
}

function clearMarkers(markers: readonly google.maps.marker.AdvancedMarkerElement[]): void {
  for (const marker of markers) marker.map = null;
}

function busClass(mode: JourneyMode, isDemo: boolean): string {
  return `google-bus google-bus--${mode.toLocaleLowerCase()}${isDemo ? ' google-bus--demo' : ''}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
