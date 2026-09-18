import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  metresPerDegreeLatitude,
  metresPerDegreeLongitude,
} from '@buskothay/geometry';
import type { JourneyMode, RouteDto } from '@buskothay/shared';
import { en } from '../../content/en.js';
import { webConfig } from '../../lib/api.js';
import { resolveBasemap, supportsWebgl } from './mapStyle.js';
import { localFallbackStyle } from './localStyle.js';
import './map-view.css';

/**
 * The passenger map.
 *
 * The map instance is created once and then driven imperatively: React state
 * updates the panel at the polling cadence, while the marker and the uncertainty
 * area are moved through the map API. Re-rendering the tree to move a dot would
 * cost far more than it buys.
 *
 * Two behaviours are deliberate. The bounds are fitted once, so the map never
 * fights a person who has panned — recentring is a button they press. And the bus
 * layer is removed entirely when there is no position, because an invented bus is
 * worse than an empty map.
 */

export interface MapViewProps {
  readonly route: RouteDto;
  readonly selectedStopId: string | null;
  readonly onSelectStop: (stopId: string) => void;
  readonly bus: { lat: number; lon: number } | null;
  readonly busMode: JourneyMode;
  readonly confidenceM: number | null;
  readonly isDemo: boolean;
}

const ROUTE_SOURCE = 'route-line';
const STOPS_SOURCE = 'route-stops';
const BUS_SOURCE = 'bus-position';
const UNCERTAINTY_SOURCE = 'bus-uncertainty';

export function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
  /** Set when the configured basemap could not be fetched and the fallback is showing. */
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const basemap = useMemo(() => resolveBasemap(webConfig), []);
  const onSelectStopRef = useRef(props.onSelectStop);
  onSelectStopRef.current = props.onSelectStop;

  // --- Create the map once. --------------------------------------------------
  useEffect(() => {
    if (!supportsWebgl()) {
      setStatus('unsupported');
      return;
    }
    const container = containerRef.current;
    if (container === null) return;
    // React's development double-invoke would otherwise build two maps in the
    // same element.
    if (mapRef.current !== null) return;

    setStatus('loading');
    setBasemapFailed(basemap.provider === 'none');

    const map = new maplibregl.Map({
      container,
      style: basemap.provider === 'none' ? localFallbackStyle() : basemap.styleUrl,
      center: centreOf(props.route),
      zoom: 11,
      pitch: 0,
      attributionControl: { compact: false },
      // Keyboard users get the map's own panning and zooming.
      keyboard: true,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    let usedFallback = basemap.provider === 'none';
    map.on('error', (event) => {
      const message = event.error?.message ?? '';
      const isStyleFailure =
        !usedFallback &&
        (message.includes('style') || message.includes('Failed to fetch') || 'status' in (event.error ?? {}));
      if (!isStyleFailure) return;
      // A blank rectangle is not an acceptable finished feature. Fall back to the
      // basemap-free surface so the route, the stops and the bus still draw, and
      // say plainly that the streets are missing.
      usedFallback = true;
      setBasemapFailed(true);
      map.setStyle(localFallbackStyle());
    });

    let hasFitted = false;
    const onStyleReady = () => {
      // `setStyle` discards every source and layer, so they are added on each
      // style load rather than only on the first.
      if (map.getLayer('route-line') === undefined) addRouteLayers(map, props.route);
      setStatus('ready');
      // Measure before fitting: on first paint the container may not have reached
      // its final height, and a fit computed against the wrong box leaves the
      // route running off the top and bottom of the map.
      map.resize();
      if (!hasFitted) {
        hasFitted = true;
        fitToRoute(map, props.route, bannerRef.current?.offsetHeight ?? 0);
      }
    };
    map.on('load', onStyleReady);
    map.on('styledata', () => {
      if (map.isStyleLoaded() && map.getSource(ROUTE_SOURCE) === undefined) onStyleReady();
    });

    map.on('click', ['stops-hit'], (event) => {
      const feature = event.features?.[0];
      const stopId = feature?.properties?.['id'];
      if (typeof stopId === 'string') onSelectStopRef.current(stopId);
    });
    map.on('mouseenter', 'stops-hit', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'stops-hit', () => {
      map.getCanvas().style.cursor = '';
    });

    // The container's real size often arrives after the first paint, so the one
    // automatic fit waits for it. After that the map is the person's to pan.
    let settleTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      map.resize();
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        if (!hasFitted) return;
        fitToRoute(map, props.route, bannerRef.current?.offsetHeight ?? 0);
        observer.disconnect();
        const sizeOnly = new ResizeObserver(() => map.resize());
        sizeOnly.observe(container);
        resizeObserverRef.current = sizeOnly;
      }, 150);
    });
    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      window.clearTimeout(settleTimer);
      observer.disconnect();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // The route's identity, not its object identity, decides whether to rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.route.id, props.route.version, basemap.styleUrl, retryKey]);

  // --- Selected stop highlighting. -------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || status !== 'ready') return;
    if (map.getLayer('stops-selected') === undefined) return;
    map.setFilter('stops-selected', ['==', ['get', 'id'], props.selectedStopId ?? '']);
  }, [props.selectedStopId, status]);

  // --- Bus marker and uncertainty area. --------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || status !== 'ready') return;

    const busSource = map.getSource(BUS_SOURCE);
    const uncertaintySource = map.getSource(UNCERTAINTY_SOURCE);
    if (busSource === undefined || uncertaintySource === undefined) return;

    if (props.bus === null) {
      // No accepted position: no bus on the map at all.
      (busSource as maplibregl.GeoJSONSource).setData(emptyCollection());
      (uncertaintySource as maplibregl.GeoJSONSource).setData(emptyCollection());
      return;
    }

    (busSource as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { mode: props.busMode },
          geometry: { type: 'Point', coordinates: [props.bus.lon, props.bus.lat] },
        },
      ],
    });

    // The uncertainty area is drawn in real metres on the ground, so it grows and
    // shrinks with the map scale exactly as the actual uncertainty does. A fixed
    // pixel ring would be decoration.
    const showArea =
      props.confidenceM !== null && (props.busMode === 'ESTIMATED' || props.busMode === 'STALE');
    (uncertaintySource as maplibregl.GeoJSONSource).setData(
      showArea
        ? circlePolygon(props.bus.lon, props.bus.lat, props.confidenceM ?? 0)
        : emptyCollection(),
    );
  }, [props.bus, props.busMode, props.confidenceM, status]);

  if (status === 'unsupported') {
    return (
      <div className="map-view map-view--message">
        <p className="notice notice--warning">{en.errors.webglMissing}</p>
      </div>
    );
  }

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-view__canvas" aria-hidden="true" />
      <div className="map-view__controls">
        <button
          type="button"
          className="map-view__control"
          onClick={() => {
            const map = mapRef.current;
            if (map !== null) fitToRoute(map, props.route);
          }}
        >
          {en.route.showRoute}
        </button>
        {props.bus !== null ? (
          <button
            type="button"
            className="map-view__control"
            onClick={() => {
              const map = mapRef.current;
              if (map !== null && props.bus !== null) {
                map.easeTo({
                  center: [props.bus.lon, props.bus.lat],
                  zoom: Math.max(map.getZoom(), 14),
                  duration: prefersReducedMotion() ? 0 : 600,
                });
              }
            }}
          >
            {en.route.recenter}
          </button>
        ) : null}
      </div>
      {basemapFailed ? (
        <div ref={bannerRef} className="map-view__disclosure map-view__disclosure--error">
          <span>
            <strong>{en.errors.mapFailed}</strong> {en.errors.mapFailedHelp}
          </span>
          <button
            type="button"
            className="map-view__retry"
            onClick={() => setRetryKey((k) => k + 1)}
          >
            {en.common.retry}
          </button>
        </div>
      ) : basemap.isDevelopmentBasemap ? (
        <div ref={bannerRef} className="map-view__disclosure">
          {en.map.developmentBasemap}
        </div>
      ) : null}
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function centreOf(route: RouteDto): [number, number] {
  const coords = route.geometry.coordinates;
  const middle = coords[Math.floor(coords.length / 2)]!;
  return [middle[0], middle[1]];
}

function boundsOf(route: RouteDto): LngLatBoundsLike {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of route.geometry.coordinates) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

function fitToRoute(map: MapLibreMap, route: RouteDto, topInsetPx = 0): void {
  map.fitBounds(boundsOf(route), {
    // The top inset keeps the route clear of the disclosure banner, which sits
    // over the map rather than above it. Without it the first stops of the route
    // hide behind the notice and the map looks cropped.
    padding: { top: 48 + topInsetPx, bottom: 48, left: 32, right: 32 },
    duration: prefersReducedMotion() ? 0 : 400,
  });
}

function addRouteLayers(map: MapLibreMap, route: RouteDto): void {
  map.addSource(ROUTE_SOURCE, {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: route.geometry },
  });
  map.addSource(STOPS_SOURCE, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: route.stops.map((stop) => ({
        type: 'Feature',
        properties: { id: stop.id, name: stop.name },
        geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
      })),
    },
  });
  map.addSource(BUS_SOURCE, { type: 'geojson', data: emptyCollection() });
  map.addSource(UNCERTAINTY_SOURCE, { type: 'geojson', data: emptyCollection() });

  // A thin white casing keeps the green route line readable over roads of any
  // colour, which the accent green alone does not manage.
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#FFFFFF', 'line-width': 8, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#285C45', 'line-width': 4 },
  });

  map.addLayer({
    id: 'bus-uncertainty',
    type: 'fill',
    source: UNCERTAINTY_SOURCE,
    paint: { 'fill-color': '#285C45', 'fill-opacity': 0.14 },
  });

  map.addLayer({
    id: 'stops',
    type: 'circle',
    source: STOPS_SOURCE,
    paint: {
      'circle-radius': 5,
      'circle-color': '#FFFFFF',
      'circle-stroke-color': '#285C45',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'stops-selected',
    type: 'circle',
    source: STOPS_SOURCE,
    filter: ['==', ['get', 'id'], ''],
    // A thick ring, not a filled disc: the filled disc is the bus, and a
    // passenger must be able to tell their stop from the vehicle at a glance.
    paint: {
      'circle-radius': 9,
      'circle-color': '#FFFFFF',
      'circle-stroke-color': '#285C45',
      'circle-stroke-width': 4,
    },
  });
  // Stop labels need a glyph source. The basemap-free fallback style has none, so
  // the labels are skipped there rather than filling the console with errors —
  // the stop list beside the map carries the same names.
  if (typeof map.getStyle().glyphs === 'string') {
    map.addLayer({
      id: 'stops-label',
      type: 'symbol',
      source: STOPS_SOURCE,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#202923',
        'text-halo-color': '#F5F4EF',
        'text-halo-width': 1.5,
      },
    });
  }
  // A generous invisible hit area: the 5px dot is not a 44px touch target.
  map.addLayer({
    id: 'stops-hit',
    type: 'circle',
    source: STOPS_SOURCE,
    paint: { 'circle-radius': 18, 'circle-color': '#000000', 'circle-opacity': 0 },
  });

  map.addLayer({
    id: 'bus-halo',
    type: 'circle',
    source: BUS_SOURCE,
    paint: {
      'circle-radius': 11,
      'circle-color': '#FFFFFF',
      'circle-opacity': 0.95,
    },
  });
  map.addLayer({
    id: 'bus',
    type: 'circle',
    source: BUS_SOURCE,
    paint: {
      'circle-radius': 7,
      // Solid while confirmed; hollow once the position is only an estimate.
      'circle-color': [
        'match',
        ['get', 'mode'],
        'ESTIMATED',
        '#FFFFFF',
        'STALE',
        '#FFFFFF',
        '#285C45',
      ],
      'circle-stroke-color': '#285C45',
      'circle-stroke-width': 3,
      'circle-opacity': ['match', ['get', 'mode'], 'STALE', 0.6, 1],
      'circle-stroke-opacity': ['match', ['get', 'mode'], 'STALE', 0.6, 1],
    },
  });
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/** A circle of `radiusM` on the ground, as a polygon in geographic coordinates. */
function circlePolygon(lon: number, lat: number, radiusM: number): GeoJSON.FeatureCollection {
  const mPerLat = metresPerDegreeLatitude(lat);
  const mPerLon = metresPerDegreeLongitude(lat);
  const steps = 48;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([
      lon + (Math.cos(angle) * radiusM) / mPerLon,
      lat + (Math.sin(angle) * radiusM) / mPerLat,
    ]);
  }
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
    ],
  };
}
