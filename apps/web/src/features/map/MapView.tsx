import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  metresPerDegreeLatitude,
  metresPerDegreeLongitude,
} from '@buskothay/geometry';
import type { JourneyMode, RouteDto, StopEta } from '@buskothay/shared';
import { MapControlButton, icons } from '../../components/MapControlButton.js';
import { en } from '../../content/en.js';
import { webConfig } from '../../lib/api.js';
import { useTheme, type Theme } from '../../lib/theme.js';
import { localFallbackStyle } from './localStyle.js';
import { resolveBasemap, supportsWebgl } from './mapStyle.js';
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

const ROUTE_SOURCE = 'route-line';
const STOPS_SOURCE = 'route-stops';
const UNCERTAINTY_SOURCE = 'bus-uncertainty';

export function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const busMarkerRef = useRef<maplibregl.Marker | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const onSelectStopRef = useRef(props.onSelectStop);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
  const [basemapState, setBasemapState] = useState<
    'loading' | 'ready' | 'missing-key' | 'failed' | 'test' | 'degraded'
  >('loading');
  const [followBus, setFollowBus] = useState(false);
  const [locationState, setLocationState] = useState<'idle' | 'locating' | 'failed'>('idle');
  const [retryKey, setRetryKey] = useState(0);
  const theme = useTheme();
  const basemap = useMemo(() => resolveBasemap(webConfig, theme), [theme]);
  onSelectStopRef.current = props.onSelectStop;

  useEffect(() => {
    if (!supportsWebgl()) {
      setStatus('unsupported');
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    let styleLoaded = basemap.provider === 'none' || basemap.isMissingKey;
    let usedFallback = styleLoaded;
    let failureTimer: number | undefined;
    setStatus('loading');
    setBasemapState(
      basemap.isMissingKey ? 'missing-key' : basemap.provider === 'none' ? 'test' : 'loading',
    );

    const map = new maplibregl.Map({
      container,
      style: usedFallback ? localFallbackStyle(theme) : basemap.styleUrl,
      center: centreOf(props.route),
      zoom: 11,
      pitch: 0,
      attributionControl: { compact: true },
      keyboard: true,
    });
    mapRef.current = map;

    map.on('error', () => {
      if (usedFallback) return;
      if (styleLoaded || map.isStyleLoaded()) {
        setBasemapState('degraded');
        return;
      }
      window.clearTimeout(failureTimer);
      failureTimer = window.setTimeout(() => {
        if (styleLoaded || usedFallback || map.isStyleLoaded()) return;
        usedFallback = true;
        setBasemapState('failed');
        map.setStyle(localFallbackStyle(theme));
      }, 900);
    });

    let hasFitted = false;
    const onStyleReady = () => {
      if (map.getSource(ROUTE_SOURCE) === undefined) addRouteLayers(map, props.route, theme);
      styleLoaded = true;
      window.clearTimeout(failureTimer);
      if (!usedFallback) setBasemapState('ready');
      setStatus('ready');
      map.resize();
      if (!hasFitted) {
        hasFitted = true;
        fitToRoute(map, props.route);
      }
    };
    map.on('load', onStyleReady);
    map.on('styledata', () => {
      if (map.isStyleLoaded() && map.getSource(ROUTE_SOURCE) === undefined) onStyleReady();
    });

    map.on('click', 'stops-hit', (event) => {
      const stopId = event.features?.[0]?.properties?.['id'];
      if (typeof stopId === 'string') onSelectStopRef.current(stopId);
    });
    map.on('mouseenter', 'stops-hit', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'stops-hit', () => {
      map.getCanvas().style.cursor = '';
    });
    const stopFollowingOnGesture = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent !== undefined) setFollowBus(false);
    };
    map.on('dragstart', stopFollowingOnGesture);
    map.on('zoomstart', stopFollowingOnGesture);
    map.on('rotatestart', stopFollowingOnGesture);

    const observer = new ResizeObserver(() => {
      map.resize();
    });
    observer.observe(container);

    return () => {
      window.clearTimeout(failureTimer);
      observer.disconnect();
      busMarkerRef.current?.remove();
      busMarkerRef.current = null;
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Rebuild for an immutable route revision, a theme-specific AWS style, or Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.route.id, props.route.version, basemap.styleUrl, retryKey, theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    const source = map.getSource(STOPS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(stopFeatures(props.route, props.stops));
  }, [props.route, props.stops, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || map.getLayer('stops-selected') === undefined) return;
    const filter: maplibregl.FilterSpecification = [
      '==',
      ['get', 'id'],
      props.selectedStopId ?? '',
    ];
    map.setFilter('stops-selected', filter);
    if (map.getLayer('stops-label-selected') !== undefined) {
      map.setFilter('stops-label-selected', filter);
    }
  }, [props.selectedStopId, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    const uncertainty = map.getSource(UNCERTAINTY_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!props.bus) {
      busMarkerRef.current?.remove();
      busMarkerRef.current = null;
      uncertainty?.setData(emptyCollection());
      return;
    }

    if (!busMarkerRef.current) {
      const element = document.createElement('div');
      element.setAttribute('role', 'img');
      element.innerHTML = '<span aria-hidden="true">▰</span>';
      busMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([props.bus.lon, props.bus.lat])
        .addTo(map);
    }
    const element = busMarkerRef.current.getElement();
    element.className = busClass(props.busMode, props.isDemo);
    element.setAttribute('aria-label', props.isDemo ? 'Demo bus position' : 'Bus position');
    busMarkerRef.current.setLngLat([props.bus.lon, props.bus.lat]);

    const showArea =
      props.confidenceM !== null &&
      (props.busMode === 'ESTIMATED' || props.busMode === 'STALE');
    uncertainty?.setData(
      showArea
        ? circlePolygon(props.bus.lon, props.bus.lat, props.confidenceM ?? 0)
        : emptyCollection(),
    );
    if (followBus) {
      map.easeTo({
        center: [props.bus.lon, props.bus.lat],
        duration: prefersReducedMotion() ? 0 : 350,
      });
    }
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
        setFollowBus(false);
        const map = mapRef.current;
        if (!map) return;
        const element = document.createElement('div');
        element.className = 'map-user';
        element.setAttribute('aria-label', 'Your location');
        userMarkerRef.current?.remove();
        userMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center' })
          .setLngLat([position.coords.longitude, position.coords.latitude])
          .addTo(map);
        map.easeTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: Math.max(map.getZoom(), 14),
          duration: prefersReducedMotion() ? 0 : 600,
        });
      },
      () => setLocationState('failed'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  if (status === 'unsupported') {
    return (
      <div className="map-view map-view--message">
        <p className="notice notice--warning">{en.errors.webglMissing}</p>
      </div>
    );
  }

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-view__canvas" aria-label="Amazon map of the bus route" />

      {basemapState === 'missing-key' ? (
        <div className="map-view__disclosure map-view__disclosure--error" role="status">
          {en.map.missingKey}
        </div>
      ) : basemapState === 'failed' ? (
        <div className="map-view__disclosure map-view__disclosure--error" role="status">
          <span><strong>{en.errors.mapFailed}</strong> {en.map.providerFailed}</span>
          <button type="button" className="map-view__retry" onClick={() => setRetryKey((key) => key + 1)}>{en.common.retry}</button>
        </div>
      ) : basemapState === 'degraded' ? (
        <div className="map-view__disclosure map-view__disclosure--warning" role="status">{en.map.tileDegraded}</div>
      ) : basemapState === 'test' ? (
        <div className="map-view__disclosure" role="status">{en.map.testBasemap}</div>
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
            if (!followBus && props.bus) {
              mapRef.current?.easeTo({ center: [props.bus.lon, props.bus.lat], zoom: Math.max(mapRef.current.getZoom(), 14) });
            }
          }} />
        ) : null}
        <MapControlButton label={locationState === 'locating' ? en.map.locating : en.route.locateMe} icon={icons.locate} isBusy={locationState === 'locating'} onClick={locate} />
      </div>
      {locationState === 'failed' ? <p className="map-view__notice">Location is unavailable. Check browser permission and try again.</p> : null}
      {basemapState === 'ready' ? <div className="map-view__provider">Amazon Location Service · live traffic</div> : null}
    </div>
  );
}

function centreOf(route: RouteDto): [number, number] {
  const points = route.geometry.coordinates;
  const point = points[Math.floor(points.length / 2)];
  return point ? [point[0], point[1]] : [88.3639, 22.5726];
}

function boundsOf(route: RouteDto): LngLatBoundsLike {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of route.geometry.coordinates) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return [[minLon, minLat], [maxLon, maxLat]];
}

function fitToRoute(map: MapLibreMap, route: RouteDto): void {
  map.fitBounds(boundsOf(route), {
    padding: { top: 62, right: 60, bottom: 64, left: 60 },
    duration: prefersReducedMotion() ? 0 : 400,
  });
}

function stopFeatures(route: RouteDto, stops: readonly StopEta[]): GeoJSON.FeatureCollection {
  const statusById = new Map(stops.map((stop) => [stop.stopId, stop.status]));
  return {
    type: 'FeatureCollection',
    features: route.stops.map((stop) => ({
      type: 'Feature',
      properties: { id: stop.id, name: stop.name, status: statusById.get(stop.id) ?? 'unknown' },
      geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
    })),
  };
}

function addRouteLayers(map: MapLibreMap, route: RouteDto, theme: Theme): void {
  const dark = theme === 'dark';
  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: route.geometry } });
  map.addSource(STOPS_SOURCE, { type: 'geojson', data: stopFeatures(route, []) });
  map.addSource(UNCERTAINTY_SOURCE, { type: 'geojson', data: emptyCollection() });
  map.addLayer({
    id: 'bus-uncertainty',
    type: 'fill',
    source: UNCERTAINTY_SOURCE,
    paint: { 'fill-color': '#ffc42e', 'fill-opacity': 0.14, 'fill-outline-color': '#ffc42e' },
  });
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': dark ? '#05080c' : '#ffffff', 'line-width': 9, 'line-opacity': 0.82 },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': route.color, 'line-width': 5 },
  });
  map.addLayer({
    id: 'stops',
    type: 'circle',
    source: STOPS_SOURCE,
    paint: {
      'circle-radius': ['match', ['get', 'status'], 'near', 7, 'passed', 5, 6],
      'circle-color': ['match', ['get', 'status'], 'passed', '#33e08d', 'near', '#ffc42e', 'upcoming', '#ff5c46', '#8397a6'],
      'circle-stroke-color': dark ? '#05080c' : '#ffffff',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'stops-selected',
    type: 'circle',
    source: STOPS_SOURCE,
    filter: ['==', ['get', 'id'], ''],
    paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#38d0ff', 'circle-stroke-width': 3 },
  });
  if (typeof map.getStyle().glyphs === 'string') {
    const labelPaint = { 'text-color': dark ? '#e9f3f9' : '#13232d', 'text-halo-color': dark ? '#05080c' : '#ffffff', 'text-halo-width': 1.5 } as const;
    map.addLayer({
      id: 'stops-label',
      type: 'symbol',
      source: STOPS_SOURCE,
      minzoom: 13,
      layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.15], 'text-anchor': 'top' },
      paint: labelPaint,
    });
    map.addLayer({
      id: 'stops-label-selected',
      type: 'symbol',
      source: STOPS_SOURCE,
      filter: ['==', ['get', 'id'], ''],
      layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: labelPaint,
    });
  }
  map.addLayer({
    id: 'stops-hit',
    type: 'circle',
    source: STOPS_SOURCE,
    paint: { 'circle-radius': 20, 'circle-color': '#000000', 'circle-opacity': 0 },
  });
}

function busClass(mode: JourneyMode, isDemo: boolean): string {
  return `map-bus map-bus--${mode.toLocaleLowerCase()}${isDemo ? ' map-bus--demo' : ''}`;
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function circlePolygon(lon: number, lat: number, radiusM: number): GeoJSON.FeatureCollection {
  const mPerLat = metresPerDegreeLatitude(lat);
  const mPerLon = metresPerDegreeLongitude(lat);
  const ring: [number, number][] = [];
  for (let index = 0; index <= 48; index += 1) {
    const angle = (index / 48) * Math.PI * 2;
    ring.push([
      lon + (Math.cos(angle) * radiusM) / mPerLon,
      lat + (Math.sin(angle) * radiusM) / mPerLat,
    ]);
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
