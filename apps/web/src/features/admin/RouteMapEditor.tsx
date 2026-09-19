import { useEffect, useRef, useState } from 'react';
import type { RouteFixture } from '@buskothay/shared';
import { webConfig } from '../../lib/api.js';
import { loadGoogleMapLibraries, loadGoogleRoutesLibrary } from '../map/googleMaps.js';
import './route-map-editor.css';

type Stop = RouteFixture['stops'][number];

export interface GeneratedRouteDetails {
  readonly coordinates: [number, number][];
  readonly distanceM: number | null;
  readonly durationMs: number | null;
}

export function RouteMapEditor({
  stops,
  geometry,
  color,
  onMoveStop,
  onAddStop,
  onGenerated,
}: {
  readonly stops: readonly Stop[];
  readonly geometry: readonly [number, number][];
  readonly color: string;
  readonly onMoveStop: (index: number, lat: number, lon: number) => void;
  readonly onAddStop: (lat: number, lon: number) => void;
  readonly onGenerated: (details: GeneratedRouteDetails) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const librariesRef = useRef<Awaited<ReturnType<typeof loadGoogleMapLibraries>> | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const addModeRef = useRef(false);
  const onAddStopRef = useRef(onAddStop);
  const onMoveStopRef = useRef(onMoveStop);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'missing-key' | 'failed'>('loading');
  const [addMode, setAddMode] = useState(false);
  const [routing, setRouting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  onAddStopRef.current = onAddStop;
  onMoveStopRef.current = onMoveStop;
  addModeRef.current = addMode;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    setMapStatus('loading');
    void loadGoogleMapLibraries(webConfig)
      .then((libraries) => {
        if (cancelled) return;
        librariesRef.current = libraries;
        const map = new libraries.maps.Map(container, {
          center: { lat: 22.552, lng: 88.365 },
          zoom: 12,
          mapId: webConfig.googleMapsMapId,
          colorScheme: libraries.core.ColorScheme.DARK,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        mapRef.current = map;
        lineRef.current = new google.maps.Polyline({
          map,
          clickable: false,
          strokeColor: color,
          strokeOpacity: 1,
          strokeWeight: 6,
        });
        map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!addModeRef.current || !event.latLng) return;
          onAddStopRef.current(event.latLng.lat(), event.latLng.lng());
          setAddMode(false);
        });
        setMapStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMapStatus(
          error instanceof Error && error.message === 'GOOGLE_MAPS_KEY_MISSING'
            ? 'missing-key'
            : 'failed',
        );
      });
    return () => {
      cancelled = true;
      for (const marker of markersRef.current) marker.map = null;
      lineRef.current?.setMap(null);
      if (mapRef.current) google.maps.event.clearInstanceListeners(mapRef.current);
      markersRef.current = [];
      mapRef.current = null;
      librariesRef.current = null;
    };
    // The map is a persistent editing surface; data effects below update it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const line = lineRef.current;
    if (!line || mapStatus !== 'ready') return;
    line.setOptions({
      path: geometry.map(([lon, lat]) => ({ lat, lng: lon })),
      strokeColor: color,
    });
  }, [color, geometry, mapStatus]);

  useEffect(() => {
    const map = mapRef.current;
    const libraries = librariesRef.current;
    if (!map || !libraries || mapStatus !== 'ready') return;
    for (const marker of markersRef.current) marker.map = null;
    markersRef.current = stops.map((stop, index) => {
      const pin = document.createElement('div');
      pin.className = 'route-editor-pin';
      pin.innerHTML = `<b>${index + 1}</b><span>${escapeHtml(stop.name)}</span>`;
      const marker = new libraries.marker.AdvancedMarkerElement({
        map,
        position: { lat: stop.lat, lng: stop.lon },
        title: `${index + 1}. ${stop.name}`,
        content: pin,
        gmpDraggable: true,
        zIndex: 30 + index,
      });
      marker.addEventListener('gmp-dragend', () => {
        const position = marker.position;
        if (position) {
          const lat = typeof position.lat === 'function' ? position.lat() : position.lat;
          const lng = typeof position.lng === 'function' ? position.lng() : position.lng;
          onMoveStopRef.current(index, lat, lng);
        }
      });
      return marker;
    });
  }, [mapStatus, stops]);

  const fit = () => {
    const map = mapRef.current;
    if (!map || stops.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const stop of stops) bounds.extend({ lat: stop.lat, lng: stop.lon });
    map.fitBounds(bounds, { top: 70, right: 60, bottom: 70, left: 60 });
  };

  useEffect(() => {
    if (mapStatus === 'ready') fit();
    // Initial framing only; dragging a pin should not move the operator's camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStatus]);

  const generateRoute = async () => {
    if (stops.length < 2) {
      setMessage('Add at least two ordered stops first.');
      return;
    }
    setRouting(true);
    setMessage(null);
    try {
      const routes = await loadGoogleRoutesLibrary(webConfig);
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const result = await routes.Route.computeRoutes({
        origin: { lat: first.lat, lng: first.lon },
        destination: { lat: last.lat, lng: last.lon },
        intermediates: stops.slice(1, -1).map((stop) => ({
          location: { lat: stop.lat, lng: stop.lon },
          vehicleStopover: true,
        })),
        fields: ['path', 'distanceMeters', 'durationMillis'],
        travelMode: 'DRIVING',
        routingPreference: routes.RoutingPreference.TRAFFIC_UNAWARE,
        polylineQuality: routes.PolylineQuality.HIGH_QUALITY,
        region: 'in',
        language: 'en-IN',
      });
      const route = result.routes?.[0];
      const path = route?.path;
      if (!route || !path || path.length < 2) throw new Error('NO_ROUTE');
      onGenerated({
        coordinates: path.map((point) => [point.lng, point.lat]),
        distanceM: route.distanceMeters ?? null,
        durationMs: route.durationMillis ?? null,
      });
      setMessage('Google road path generated. Review every stop and the full line before publishing.');
      window.setTimeout(fit, 0);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'GOOGLE_MAPS_KEY_MISSING'
          ? 'Add a Google Maps API key before generating a road path.'
          : 'Google could not calculate this route. Check the stop order and enabled APIs.',
      );
    } finally {
      setRouting(false);
    }
  };

  return (
    <section className={`route-map-editor${addMode ? ' is-adding' : ''}`} aria-label="Route map editor">
      <div ref={containerRef} className="route-map-editor__canvas" />
      {mapStatus !== 'ready' ? (
        <div className="route-map-editor__fallback" role="status">
          <strong>{mapStatus === 'loading' ? 'Loading Google Maps…' : 'Google Maps unavailable'}</strong>
          <span>{mapStatus === 'missing-key' ? 'Set VITE_GOOGLE_MAPS_API_KEY to edit route geometry.' : 'Check the key, API restrictions, and network connection.'}</span>
        </div>
      ) : null}
      <div className="route-map-editor__tools">
        <button className="button button--secondary" type="button" onClick={() => setAddMode((value) => !value)} disabled={mapStatus !== 'ready'}>
          {addMode ? 'Cancel map click' : 'Add stop on map'}
        </button>
        <button className="button button--secondary" type="button" onClick={fit} disabled={mapStatus !== 'ready'}>Fit stops</button>
        <button className="button" type="button" onClick={generateRoute} disabled={routing || mapStatus !== 'ready'}>
          {routing ? 'Generating…' : 'Generate road path'}
        </button>
      </div>
      {addMode ? <p className="route-map-editor__instruction">Click the map where the next stop should be added.</p> : null}
      {message ? <p className="route-map-editor__message" role="status">{message}</p> : null}
    </section>
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
