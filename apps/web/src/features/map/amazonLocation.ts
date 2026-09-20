import type { WebConfig } from '../../config/site.js';

export interface AmazonRouteResult {
  readonly coordinates: [number, number][];
  readonly distanceM: number | null;
  readonly durationMs: number | null;
}

interface CalculateRoutesResponse {
  readonly Routes?: readonly {
    readonly Legs?: readonly {
      readonly Geometry?: { readonly LineString?: unknown };
    }[];
    readonly Summary?: { readonly Distance?: unknown; readonly Duration?: unknown };
  }[];
}

export async function calculateAmazonRoute(
  config: WebConfig,
  stops: readonly { readonly lat: number; readonly lon: number }[],
): Promise<AmazonRouteResult> {
  if (config.mapProvider !== 'amazon' || config.locationApiKey.length === 0) {
    throw new Error('AMAZON_LOCATION_KEY_MISSING');
  }
  if (stops.length < 2) throw new Error('AMAZON_LOCATION_STOPS_MISSING');

  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  const url = new URL(`https://routes.geo.${config.awsRegion}.amazonaws.com/v2/routes`);
  url.searchParams.set('key', config.locationApiKey);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      Origin: [first.lon, first.lat],
      Destination: [last.lon, last.lat],
      Waypoints: stops.slice(1, -1).map((stop) => ({
        Position: [stop.lon, stop.lat],
        PassThrough: false,
      })),
      TravelMode: 'Car',
      OptimizeRoutingFor: 'FastestRoute',
      LegGeometryFormat: 'Simple',
      LegAdditionalFeatures: ['Summary'],
      MaxAlternatives: 0,
    }),
  });
  if (!response.ok) throw new Error(`AMAZON_LOCATION_ROUTE_HTTP_${response.status}`);
  return parseCalculateRoutesResponse((await response.json()) as CalculateRoutesResponse);
}

export function parseCalculateRoutesResponse(
  response: CalculateRoutesResponse,
): AmazonRouteResult {
  const route = response.Routes?.[0];
  if (!route) throw new Error('AMAZON_LOCATION_ROUTE_EMPTY');

  const coordinates: [number, number][] = [];
  for (const leg of route.Legs ?? []) {
    const line = leg.Geometry?.LineString;
    if (!Array.isArray(line)) continue;
    for (const candidate of line) {
      if (!isCoordinate(candidate)) throw new Error('AMAZON_LOCATION_ROUTE_INVALID');
      const previous = coordinates.at(-1);
      if (previous?.[0] !== candidate[0] || previous[1] !== candidate[1]) {
        coordinates.push([candidate[0], candidate[1]]);
      }
    }
  }
  if (coordinates.length < 2) throw new Error('AMAZON_LOCATION_ROUTE_EMPTY');

  const distance = finiteNumber(route.Summary?.Distance);
  const durationSeconds = finiteNumber(route.Summary?.Duration);
  return {
    coordinates,
    distanceM: distance,
    durationMs: durationSeconds === null ? null : durationSeconds * 1000,
  };
}

function isCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
