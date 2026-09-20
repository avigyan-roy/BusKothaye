import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { RouteFixture } from '@buskothay/shared';
import { webConfig } from '../../lib/api.js';
import { useTheme } from '../../lib/theme.js';
import { calculateAmazonRoute } from '../map/amazonLocation.js';
import { localFallbackStyle } from '../map/localStyle.js';
import { resolveBasemap, supportsWebgl } from '../map/mapStyle.js';
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
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const addModeRef = useRef(false);
  const onAddStopRef = useRef(onAddStop);
  const onMoveStopRef = useRef(onMoveStop);
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
  const [providerState, setProviderState] = useState<
    'loading' | 'ready' | 'missing-key' | 'failed' | 'test'
  >('loading');
  const [addMode, setAddMode] = useState(false);
  const [routing, setRouting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const theme = useTheme();
  const basemap = useMemo(() => resolveBasemap(webConfig, theme), [theme]);

  onAddStopRef.current = onAddStop;
  onMoveStopRef.current = onMoveStop;
  addModeRef.current = addMode;

  useEffect(() => {
    if (!supportsWebgl()) {
      setMapStatus('unsupported');
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    let styleLoaded = basemap.provider === 'none' || basemap.isMissingKey;
    let usedFallback = styleLoaded;
    let failureTimer: number | undefined;
    setMapStatus('loading');
    setProviderState(
      basemap.isMissingKey ? 'missing-key' : basemap.provider === 'none' ? 'test' : 'loading',
    );

    const map = new maplibregl.Map({
      container,
      style: usedFallback ? localFallbackStyle(theme) : basemap.styleUrl,
      center: centreOf(stops, geometry),
      zoom: 12,
      attributionControl: { compact: true },
      keyboard: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('error', () => {
      if (usedFallback) return;
      if (styleLoaded || map.isStyleLoaded()) return;
      window.clearTimeout(failureTimer);
      failureTimer = window.setTimeout(() => {
        if (styleLoaded || usedFallback || map.isStyleLoaded()) return;
        usedFallback = true;
        setProviderState('failed');
        map.setStyle(localFallbackStyle(theme));
      }, 900);
    });

    const onStyleReady = () => {
      if (map.getSource('editor-route') === undefined) {
        map.addSource('editor-route', { type: 'geojson', data: lineFeature(geometry) });
        map.addLayer({
          id: 'editor-route-casing',
          type: 'line',
          source: 'editor-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': theme === 'light' ? '#ffffff' : '#05080c', 'line-width': 9 },
        });
        map.addLayer({
          id: 'editor-route-line',
          type: 'line',
          source: 'editor-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': color, 'line-width': 5 },
        });
      }
      styleLoaded = true;
      window.clearTimeout(failureTimer);
      if (!usedFallback) setProviderState('ready');
      setMapStatus('ready');
      map.resize();
    };
    map.on('load', onStyleReady);
    map.on('styledata', () => {
      if (map.isStyleLoaded() && map.getSource('editor-route') === undefined) onStyleReady();
    });
    map.on('click', (event) => {
      if (!addModeRef.current) return;
      onAddStopRef.current(event.lngLat.lat, event.lngLat.lng);
      setAddMode(false);
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    return () => {
      window.clearTimeout(failureTimer);
      observer.disconnect();
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // Rebuild when the Amazon style changes with the application theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap.styleUrl, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== 'ready') return;
    const source = map.getSource('editor-route') as maplibregl.GeoJSONSource | undefined;
    source?.setData(lineFeature(geometry));
    if (map.getLayer('editor-route-line') !== undefined) {
      map.setPaintProperty('editor-route-line', 'line-color', color);
    }
  }, [color, geometry, mapStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== 'ready') return;
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = stops.map((stop, index) => {
      const pin = document.createElement('div');
      pin.className = 'route-editor-pin';
      pin.innerHTML = `<b>${index + 1}</b><span>${escapeHtml(stop.name)}</span>`;
      const marker = new maplibregl.Marker({ element: pin, draggable: true, anchor: 'bottom' })
        .setLngLat([stop.lon, stop.lat])
        .addTo(map);
      marker.on('dragend', () => {
        const position = marker.getLngLat();
        onMoveStopRef.current(index, position.lat, position.lng);
      });
      return marker;
    });
  }, [mapStatus, stops]);

  const fit = () => {
    const map = mapRef.current;
    if (!map || stops.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const stop of stops) bounds.extend([stop.lon, stop.lat]);
    map.fitBounds(bounds, { padding: 70, duration: prefersReducedMotion() ? 0 : 400 });
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
      const result = await calculateAmazonRoute(webConfig, stops);
      onGenerated(result);
      setMessage('Amazon road path generated. Review every stop and the full line before publishing.');
      window.setTimeout(fit, 0);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message === 'AMAZON_LOCATION_KEY_MISSING'
          ? 'Add a restricted Amazon Location API key before generating a road path.'
          : 'Amazon Location could not calculate this route. Check the stop order, key actions, quota and network.',
      );
    } finally {
      setRouting(false);
    }
  };

  const canGenerate = providerState === 'ready';
  return (
    <section className={`route-map-editor${addMode ? ' is-adding' : ''}`} aria-label="Route map editor">
      <div ref={containerRef} className="route-map-editor__canvas" />
      {mapStatus === 'unsupported' ? (
        <div className="route-map-editor__fallback" role="status"><strong>WebGL is unavailable</strong><span>Use the coordinate fields below to edit stops.</span></div>
      ) : null}
      {providerState === 'missing-key' || providerState === 'test' || providerState === 'failed' ? (
        <div className="route-map-editor__provider" role="status">
          {providerState === 'missing-key'
            ? 'Amazon Location is not configured. The saved route remains visible on a plain surface.'
            : providerState === 'test'
              ? 'Amazon street tiles are disabled in this deterministic test build.'
              : 'Amazon street tiles could not load. The saved route remains visible on a plain surface.'}
        </div>
      ) : null}
      <div className="route-map-editor__tools">
        <button className="button button--secondary" type="button" onClick={() => setAddMode((value) => !value)} disabled={mapStatus !== 'ready'}>
          {addMode ? 'Cancel map click' : 'Add stop on map'}
        </button>
        <button className="button button--secondary" type="button" onClick={fit} disabled={mapStatus !== 'ready'}>Fit stops</button>
        <button className="button" type="button" onClick={generateRoute} disabled={routing || !canGenerate} title={canGenerate ? undefined : 'Configure Amazon Location Maps and Routes actions first'}>
          {routing ? 'Generating…' : 'Generate road path'}
        </button>
      </div>
      {addMode ? <p className="route-map-editor__instruction">Click the map where the next stop should be added.</p> : null}
      {message ? <p className="route-map-editor__message" role="status">{message}</p> : null}
    </section>
  );
}

function lineFeature(coordinates: readonly [number, number][]): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...coordinates] } };
}

function centreOf(stops: readonly Stop[], geometry: readonly [number, number][]): [number, number] {
  const stop = stops[Math.floor(stops.length / 2)];
  if (stop) return [stop.lon, stop.lat];
  const point = geometry[Math.floor(geometry.length / 2)];
  return point ? [point[0], point[1]] : [88.3639, 22.5726];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
