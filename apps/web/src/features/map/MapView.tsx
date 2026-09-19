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
import { resolveBasemap, supportsWebgl } from './mapStyle.js';
import { localFallbackStyle } from './localStyle.js';
import './map-view.css';

/**
 * The passenger map.
 *
 * The map instance is created once and then driven imperatively: React state
 * updates the sheet at the polling cadence, while the marker and the uncertainty
 * area are moved through the map API. Re-rendering the tree to move a dot would
 * cost far more than it buys.
 *
 * Two behaviours are deliberate. The bounds are fitted once, so the map never
 * fights a person who has panned — recentring is a button they press. And the bus
 * layer is removed entirely when there is no position, because an invented bus is
 * worse than an empty map.
 *
 * The transit layers are the only saturated thing on a deliberately dark
 * basemap: a dark casing under a single accent route line, quiet stop dots, and
 * one near-white vehicle that is never the same shape or colour as anything else
 * on the map.
 */

export interface MapViewProps {
  readonly route: RouteDto;
  /** Per-stop arrival state, used to separate passed stops from the ones ahead. */
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
const BUS_SOURCE = 'bus-position';
const UNCERTAINTY_SOURCE = 'bus-uncertainty';
const USER_SOURCE = 'user-location';

export function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
  const [basemapState, setBasemapState] = useState<
    'loading' | 'ready' | 'missing-key' | 'failed' | 'test' | 'degraded'
  >('loading');
  const [followBus, setFollowBus] = useState(false);
  const [locationState, setLocationState] = useState<'idle' | 'locating' | 'failed'>('idle');
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
    setBasemapState(
      basemap.isMissingKey ? 'missing-key' : basemap.provider === 'none' ? 'test' : 'loading',
    );

    const map = new maplibregl.Map({
      container,
      style:
        basemap.provider === 'none' || basemap.isMissingKey
          ? localFallbackStyle()
          : basemap.styleUrl,
      center: centreOf(props.route),
      zoom: 11,
      pitch: 0,
      attributionControl: { compact: false },
      // Keyboard users get the map's own panning and zooming.
      keyboard: true,
    });
    mapRef.current = map;

    // Zoom buttons and the scale bar are desktop furniture; CSS hides them on a
    // phone, where pinch and the sheet do the same work without crowding the map.
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-left');

    let styleLoaded = basemap.provider === 'none' || basemap.isMissingKey;
    let usedFallback = styleLoaded;
    let initialFailureTimer: number | undefined;
    map.on('error', () => {
      if (usedFallback) return;
      if (styleLoaded) {
        // MapLibre reports a dead tile, glyph or sprite through the same event as
        // a descriptor that never loaded. A resource failure must not call
        // setStyle(): doing so destroys every application overlay.
        setBasemapState('degraded');
        return;
      }
      // Give the descriptor a short grace period. Browsers can emit a transient
      // resource error before the style finishes; only a style that still has not
      // loaded is replaced with the honest basemap-free surface.
      window.clearTimeout(initialFailureTimer);
      initialFailureTimer = window.setTimeout(() => {
        if (styleLoaded || usedFallback || map.isStyleLoaded()) return;
        usedFallback = true;
        setBasemapState('failed');
        map.setStyle(localFallbackStyle());
      }, 800);
    });

    let hasFitted = false;
    const onStyleReady = () => {
      // `setStyle` discards every source and layer, so they are added on each
      // style load rather than only on the first.
      if (map.getLayer('route-line') === undefined) {
        addRouteLayers(map, props.route);
        // After the application's own layers exist, so that the `styledata`
        // handler below sees the route source and does not re-enter this.
        if (basemap.isDevelopmentBasemap) darkenBasemapLayers(map);
      }
      styleLoaded = true;
      window.clearTimeout(initialFailureTimer);
      if (!usedFallback) setBasemapState('ready');
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

    const cancelFollowForGesture = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent !== undefined) setFollowBus(false);
    };
    map.on('dragstart', cancelFollowForGesture);
    map.on('zoomstart', cancelFollowForGesture);
    map.on('rotatestart', cancelFollowForGesture);
    map.on('pitchstart', cancelFollowForGesture);

    // The container's real size often arrives after the first paint, so the one
    // automatic fit waits for it. After that the map is the person's to pan.
    let settleTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      map.resize();
      window.clearTimeout(settleTimer);
      window.clearTimeout(initialFailureTimer);
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

  useEffect(() => {
    const map = mapRef.current;
    if (!followBus || map === null || props.bus === null || status !== 'ready') return;
    map.easeTo({
      center: [props.bus.lon, props.bus.lat],
      duration: prefersReducedMotion() ? 0 : 350,
    });
  }, [followBus, props.bus, status]);

  // --- Stop state and selection. ---------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || status !== 'ready') return;
    const source = map.getSource(STOPS_SOURCE);
    if (source === undefined) return;
    (source as maplibregl.GeoJSONSource).setData(stopFeatures(props.route, props.stops));
  }, [props.route, props.stops, status]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || status !== 'ready') return;
    if (map.getLayer('stops-selected') === undefined) return;
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
          // A simulated vehicle says so on the map as well as in the sheet.
          properties: { mode: props.busMode, demo: props.isDemo, label: en.common.demoBadge },
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
  }, [props.bus, props.busMode, props.confidenceM, props.isDemo, status]);

  if (status === 'unsupported') {
    return (
      <div className="map-view map-view--message">
        <p className="notice notice--warning">{en.errors.webglMissing}</p>
      </div>
    );
  }

  const showLocation = (position: GeolocationPosition) => {
    const map = mapRef.current;
    setLocationState('idle');
    setFollowBus(false);
    if (map === null) return;
    const source = map.getSource(USER_SOURCE);
    if (source !== undefined) {
      (source as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Point',
              coordinates: [position.coords.longitude, position.coords.latitude],
            },
          },
        ],
      });
    }
    map.easeTo({
      center: [position.coords.longitude, position.coords.latitude],
      zoom: Math.max(map.getZoom(), 14),
      duration: prefersReducedMotion() ? 0 : 600,
    });
  };

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-view__canvas" aria-hidden="true" />

      <div className="map-view__actions">
        <MapControlButton
          label={en.route.showRoute}
          icon={icons.wholeRoute}
          onClick={() => {
            const map = mapRef.current;
            if (map !== null) fitToRoute(map, props.route);
          }}
        />
        {props.bus !== null ? (
          <MapControlButton
            label={followBus ? en.route.stopFollowing : en.route.followBus}
            icon={icons.followBus}
            isActive={followBus}
            onClick={() => {
              const map = mapRef.current;
              if (followBus) {
                setFollowBus(false);
                return;
              }
              if (map !== null && props.bus !== null) {
                setFollowBus(true);
                map.easeTo({
                  center: [props.bus.lon, props.bus.lat],
                  zoom: Math.max(map.getZoom(), 14),
                  duration: prefersReducedMotion() ? 0 : 600,
                });
              }
            }}
          />
        ) : null}
        <MapControlButton
          label={locationState === 'locating' ? en.map.locating : en.route.locateMe}
          icon={icons.locate}
          isBusy={locationState === 'locating'}
          onClick={() => {
            if (!('geolocation' in navigator)) {
              setLocationState('failed');
              return;
            }
            setLocationState('locating');
            navigator.geolocation.getCurrentPosition(
              showLocation,
              () => setLocationState('failed'),
              { enableHighAccuracy: true, maximumAge: 15_000, timeout: 10_000 },
            );
          }}
        />
      </div>

      {basemapState === 'missing-key' ? (
        <div ref={bannerRef} className="map-view__disclosure map-view__disclosure--error">
          {en.map.missingKey}
        </div>
      ) : basemapState === 'failed' ? (
        <div ref={bannerRef} className="map-view__disclosure map-view__disclosure--error">
          <span>
            <strong>{en.errors.mapFailed}</strong> {en.map.providerFailed}
          </span>
          <button
            type="button"
            className="map-view__retry"
            onClick={() => setRetryKey((k) => k + 1)}
          >
            {en.common.retry}
          </button>
        </div>
      ) : basemapState === 'degraded' ? (
        <div ref={bannerRef} className="map-view__disclosure map-view__disclosure--warning">
          {en.map.tileDegraded}
        </div>
      ) : basemapState === 'test' ? (
        <div ref={bannerRef} className="map-view__disclosure">
          {en.map.testBasemap}
        </div>
      ) : basemap.isDevelopmentBasemap ? (
        <div ref={bannerRef} className="map-view__disclosure">
          {en.map.developmentBasemap}
        </div>
      ) : null}

      {locationState === 'failed' ? (
        <div className="map-view__location-error" role="status">
          {en.map.locationFailed}
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

/**
 * How much of the map the journey sheet is currently covering, read from the
 * same custom properties that position it: `--sheet-h` at the bottom on a phone,
 * `--panel-inset` on the left where the drawer sits instead.
 */
function overlayInsetPx(map: MapLibreMap, property: '--sheet-h' | '--panel-inset'): number {
  const value = window.getComputedStyle(map.getContainer()).getPropertyValue(property).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fitToRoute(map: MapLibreMap, route: RouteDto, topInsetPx = 0): void {
  map.fitBounds(boundsOf(route), {
    // The insets keep the route clear of the things sitting over the map: the
    // disclosure banner at the top and the journey sheet at the bottom. Without
    // them the ends of the route hide behind the furniture and the map looks
    // cropped.
    padding: {
      top: 64 + topInsetPx,
      bottom: 32 + overlayInsetPx(map, '--sheet-h'),
      left: 32 + overlayInsetPx(map, '--panel-inset'),
      right: 32,
    },
    duration: prefersReducedMotion() ? 0 : 400,
  });
}

/**
 * Recolour a light basemap to this interface's dark surface.
 *
 * Only the development basemap needs this. Production asks Amazon Location for
 * the dark colour scheme and gets a properly designed dark style back; the
 * MapLibre demonstration style has one light palette and no such option, and a
 * bright blue-and-yellow world map underneath a dark interface would make the
 * local build impossible to judge. It is a recolour of the fallback, not a claim
 * about the production map — the disclosure over the map still says which one is
 * in use.
 */
function darkenBasemapLayers(map: MapLibreMap): void {
  const ownSources = new Set([
    ROUTE_SOURCE,
    STOPS_SOURCE,
    BUS_SOURCE,
    UNCERTAINTY_SOURCE,
    USER_SOURCE,
  ]);
  for (const layer of map.getStyle().layers ?? []) {
    // Never the transit layers: those carry the palette this recolour exists to
    // let a person see.
    if ('source' in layer && ownSources.has(layer.source)) continue;
    try {
      switch (layer.type) {
        case 'background':
          map.setPaintProperty(layer.id, 'background-color', '#0E100F');
          break;
        case 'fill':
          map.setPaintProperty(layer.id, 'fill-color', '#191B1A');
          map.setPaintProperty(layer.id, 'fill-outline-color', '#242826');
          break;
        case 'line':
          map.setPaintProperty(layer.id, 'line-color', '#2C302D');
          break;
        case 'symbol':
          map.setPaintProperty(layer.id, 'text-color', '#7E847D');
          map.setPaintProperty(layer.id, 'text-halo-color', '#0B0D0C');
          break;
        default:
          break;
      }
    } catch {
      // A layer that does not accept this property keeps the style's own value.
    }
  }
}

/** Stop geometry joined to whatever arrival state is known for each stop. */
function stopFeatures(route: RouteDto, stops: readonly StopEta[]): GeoJSON.FeatureCollection {
  const statusById = new Map(stops.map((stop) => [stop.stopId, stop.status]));
  return {
    type: 'FeatureCollection',
    features: route.stops.map((stop) => ({
      type: 'Feature',
      properties: {
        id: stop.id,
        name: stop.name,
        status: statusById.get(stop.id) ?? 'unknown',
      },
      geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
    })),
  };
}

function addRouteLayers(map: MapLibreMap, route: RouteDto): void {
  map.addSource(ROUTE_SOURCE, {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: route.geometry },
  });
  map.addSource(STOPS_SOURCE, { type: 'geojson', data: stopFeatures(route, []) });
  map.addSource(BUS_SOURCE, { type: 'geojson', data: emptyCollection() });
  map.addSource(UNCERTAINTY_SOURCE, { type: 'geojson', data: emptyCollection() });
  map.addSource(USER_SOURCE, { type: 'geojson', data: emptyCollection() });

  // A dark casing separates the route from the roads underneath it without the
  // glow that a bright halo would add.
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#0B0D0C',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 9, 17, 13],
      'line-opacity': 0.85,
    },
  });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': route.color,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 4.5, 17, 6.5],
    },
  });

  map.addLayer({
    id: 'bus-uncertainty',
    type: 'fill',
    source: UNCERTAINTY_SOURCE,
    paint: { 'fill-color': '#F1F2ED', 'fill-opacity': 0.12 },
  });

  // Ordinary stops stay quiet. A passed stop is hollow and smaller, a stop the
  // bus is at is filled and larger — shape and size, not only colour.
  map.addLayer({
    id: 'stops',
    type: 'circle',
    source: STOPS_SOURCE,
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['match', ['get', 'status'], 'near', 4, 2.5],
        14,
        ['match', ['get', 'status'], 'near', 6.5, 'passed', 4, 5],
        17,
        ['match', ['get', 'status'], 'near', 8, 'passed', 5, 6.5],
      ],
      'circle-color': [
        'match',
        ['get', 'status'],
        'passed',
        '#111312',
        'near',
        route.color,
        '#C9CEC6',
      ],
      'circle-stroke-color': [
        'match',
        ['get', 'status'],
        'passed',
        '#6B716A',
        'near',
        '#0B0D0C',
        '#0B0D0C',
      ],
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'stops-selected',
    type: 'circle',
    source: STOPS_SOURCE,
    filter: ['==', ['get', 'id'], ''],
    // A ring around the stop, not a filled disc: the filled disc is the bus, and
    // a passenger must be able to tell their stop from the vehicle at a glance.
    paint: {
      'circle-radius': 10,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#E5BD45',
      'circle-stroke-width': 2.5,
    },
  });

  // Labels need a glyph source. The basemap-free fallback style has none, so the
  // labels are skipped there rather than filling the console with errors — the
  // stop list in the sheet carries the same names.
  const hasGlyphs = typeof map.getStyle().glyphs === 'string';
  if (hasGlyphs) {
    map.addLayer({
      id: 'stops-label',
      type: 'symbol',
      source: STOPS_SOURCE,
      // Close in, names help. Zoomed out they would cover the city.
      minzoom: 13,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#D5D9D2',
        'text-halo-color': '#0B0D0C',
        'text-halo-width': 1.4,
      },
    });
    map.addLayer({
      id: 'stops-label-selected',
      type: 'symbol',
      source: STOPS_SOURCE,
      filter: ['==', ['get', 'id'], ''],
      layout: {
        'text-field': ['get', 'name'],
        'text-size': 13,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#F1F2ED',
        'text-halo-color': '#0B0D0C',
        'text-halo-width': 1.6,
      },
    });
  }

  // A generous invisible hit area: a 5px dot is not a 44px touch target.
  map.addLayer({
    id: 'stops-hit',
    type: 'circle',
    source: STOPS_SOURCE,
    paint: { 'circle-radius': 18, 'circle-color': '#000000', 'circle-opacity': 0 },
  });

  // The person's own location. Deliberately a different colour and a different
  // construction from the vehicle, so the two are never confused.
  map.addLayer({
    id: 'user-location-halo',
    type: 'circle',
    source: USER_SOURCE,
    paint: { 'circle-radius': 14, 'circle-color': '#8EB6FF', 'circle-opacity': 0.18 },
  });
  map.addLayer({
    id: 'user-location',
    type: 'circle',
    source: USER_SOURCE,
    paint: {
      'circle-radius': 5,
      'circle-color': '#8EB6FF',
      'circle-stroke-color': '#0B0D0C',
      'circle-stroke-width': 2,
    },
  });

  // The vehicle is the last thing drawn and the only near-white mark on the map.
  map.addLayer({
    id: 'bus-casing',
    type: 'circle',
    source: BUS_SOURCE,
    paint: { 'circle-radius': 11, 'circle-color': '#0B0D0C', 'circle-opacity': 0.9 },
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
        '#0B0D0C',
        'STALE',
        '#0B0D0C',
        '#F1F2ED',
      ],
      'circle-stroke-color': '#F1F2ED',
      'circle-stroke-width': 3,
      'circle-opacity': ['match', ['get', 'mode'], 'STALE', 0.65, 1],
      'circle-stroke-opacity': ['match', ['get', 'mode'], 'STALE', 0.65, 1],
    },
  });
  if (hasGlyphs) {
    map.addLayer({
      id: 'bus-demo-label',
      type: 'symbol',
      source: BUS_SOURCE,
      filter: ['==', ['get', 'demo'], true],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-offset': [0, -1.5],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#D79B45',
        'text-halo-color': '#0B0D0C',
        'text-halo-width': 1.6,
      },
    });
  }
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
