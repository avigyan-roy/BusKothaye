#!/usr/bin/env node
/**
 * Replace a route fixture's hand-authored corridor with a real road trace.
 *
 * The committed AC24 geometry is an approximation: the machine that built this
 * repository had no network route to any routing provider, so the corridor was
 * placed by hand and labelled `isApproximateGeometry: true`. This script is how
 * you replace it once you have access to one.
 *
 *   node scripts/fetch-route-geometry.mjs \
 *     --route ac24-patuli-howrah \
 *     --provider amazon \
 *     --region ap-south-1
 *
 * Providers:
 *   amazon  Amazon Location Routes V2, using your ambient AWS credentials.
 *   osrm    Any OSRM-compatible endpoint, with --endpoint. Check the licence of
 *           whatever instance you point at before shipping its geometry.
 *
 * It writes the new coordinates and bumps nothing else. You then have to:
 *   1. Look at the line on a street map. Routing through endpoints alone will
 *      happily pick a different road; that is why every checkpoint is a waypoint.
 *   2. Bump `version` in the fixture. Active journeys keep their old version.
 *   3. Run `npm run routes:validate` and check the distances that prints.
 *   4. Set `isApproximateGeometry` (and `areStopsApproximate`, once the boarding
 *      points are verified) to false — by hand, after looking. This script will
 *      not set them for you, because it cannot look.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const routeId = arg('route', 'ac24-patuli-howrah');
const provider = arg('provider', 'amazon');
const region = arg('region', 'ap-south-1');
const endpoint = arg('endpoint');
const path = resolve(arg('file', `data/routes/${routeId}.json`));

const fixture = JSON.parse(await readFile(path, 'utf8'));
const waypoints = fixture.stops.map((stop) => [stop.lon, stop.lat]);
if (waypoints.length < 2) {
  console.error('The fixture needs at least two stops to route between.');
  process.exit(2);
}

console.log(
  `Routing ${waypoints.length} waypoints for ${fixture.code} ${fixture.origin} → ${fixture.destination} via ${provider}…`,
);

let coordinates;
if (provider === 'osrm') {
  if (endpoint === null) {
    console.error('--endpoint is required for the osrm provider.');
    process.exit(2);
  }
  const path_ = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const url = `${endpoint.replace(/\/$/, '')}/route/v1/driving/${path_}?overview=full&geometries=geojson`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Routing failed: ${response.status} ${await response.text()}`);
    process.exit(1);
  }
  const body = await response.json();
  coordinates = body.routes?.[0]?.geometry?.coordinates;
} else if (provider === 'amazon') {
  // Imported lazily so the script runs without the SDK when using OSRM.
  const { GeoRoutesClient, CalculateRoutesCommand } = await import(
    '@aws-sdk/client-geo-routes'
  );
  const client = new GeoRoutesClient({ region });
  const response = await client.send(
    new CalculateRoutesCommand({
      Origin: waypoints[0],
      Destination: waypoints.at(-1),
      Waypoints: waypoints.slice(1, -1).map((position) => ({ Position: position })),
      TravelMode: 'Car',
      LegGeometryFormat: 'Simple',
      LegAdditionalFeatures: ['Summary'],
    }),
  );
  coordinates = (response.Routes?.[0]?.Legs ?? []).flatMap(
    (leg) => leg.Geometry?.LineString ?? [],
  );
} else {
  console.error(`Unknown provider "${provider}". Use "amazon" or "osrm".`);
  process.exit(2);
}

if (!Array.isArray(coordinates) || coordinates.length < 2) {
  console.error('The provider returned no usable geometry.');
  process.exit(1);
}

const next = {
  ...fixture,
  geometry: { type: 'LineString', coordinates },
  provenance: {
    ...fixture.provenance,
    geometrySource: `Generated with ${provider} on ${new Date().toISOString().slice(0, 10)}`,
    // Left true on purpose. Only a person who has looked at the line on a street
    // map can honestly set this to false.
    isApproximateGeometry: true,
  },
};

await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);

console.log(`Wrote ${coordinates.length} points to ${path}.`);
console.log('\nStill to do, by hand:');
console.log('  1. Inspect the line on a street map — routing can pick another road.');
console.log('  2. Bump `version` in the fixture.');
console.log('  3. npm run routes:validate');
console.log('  4. Set isApproximateGeometry to false only once you have looked.');
