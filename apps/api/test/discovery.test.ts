import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AccountRole,
  ArrivalsResponse,
  AuthSessionResponse,
  CreateJourneyResponse,
  PreparedRoute,
  StopDirectoryResponse,
} from '@buskothay/shared';
import { http, loadAc24, reportAt, startTestServer, type TestServer } from './helpers.js';

/**
 * Stop-first discovery.
 *
 * These are the two questions the passenger app is built around, so they are
 * tested against real journeys and real committed geometry rather than against
 * a stub: the point of the endpoint is that the browser holds no opinion about
 * which routes exist or where they go, and that only holds if the server's
 * answer is derived from the route data it actually loaded.
 */

const OUTBOUND = 'ac24-patuli-howrah';
let route: PreparedRoute;
let server: TestServer;
let accountCounter = 0;

beforeAll(async () => {
  route = await loadAc24();
});

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
});

async function register(role: AccountRole): Promise<string> {
  accountCounter += 1;
  const result = await http<AuthSessionResponse>(server.url, 'POST', '/v1/auth/register', {
    body: {
      username: `discovery-${role}-${accountCounter}`,
      password: 'correct horse battery staple',
      role,
    },
  });
  expect(result.status).toBe(201);
  return result.body.token;
}

/** A journey on the outbound route, reporting from a known distance along it. */
async function journeyAt(sM: number): Promise<CreateJourneyResponse> {
  const token = await register('driver');
  const created = await http<CreateJourneyResponse>(server.url, 'POST', '/v1/journeys', {
    token,
    body: { routeId: OUTBOUND },
  });
  expect(created.status).toBe(201);
  const reported = await http(
    server.url,
    'POST',
    `/v1/journeys/${created.body.journeyId}/locations`,
    { token: created.body.contributorToken, body: reportAt(route, { seq: 0, sM }) },
  );
  expect(reported.status).toBe(202);
  return created.body;
}

describe('stop directory', () => {
  it('merges the same stop across routes instead of listing it twice', async () => {
    const result = await http<StopDirectoryResponse>(server.url, 'GET', '/v1/stops');
    expect(result.status).toBe(200);

    const howrah = result.body.stops.filter((stop) => stop.key === 'howrah');
    expect(howrah).toHaveLength(1);
    // The committed fixtures run the same corridor in both directions, so the
    // one directory entry must name both of them.
    expect(howrah[0]!.routes.map((entry) => entry.direction).sort()).toEqual([
      'inbound',
      'outbound',
    ]);
  });

  it('carries each route’s own stop ID and position in the order', async () => {
    const result = await http<StopDirectoryResponse>(server.url, 'GET', '/v1/stops');
    const esplanade = result.body.stops.find((stop) => stop.key === 'esplanade');
    const outbound = esplanade?.routes.find((entry) => entry.routeId === OUTBOUND);
    expect(outbound?.stopId).toBe('esplanade');
    expect(outbound?.sequence).toBeGreaterThan(0);
    expect(outbound?.sequence).toBeLessThan(outbound!.stopCount);
  });
});

describe('arrivals', () => {
  it('lists only routes that reach the destination after the boarding stop', async () => {
    const forwards = await http<ArrivalsResponse>(
      server.url,
      'GET',
      '/v1/arrivals?from=patuli&to=howrah',
    );
    expect(forwards.status).toBe(200);
    expect(forwards.body.arrivals.map((arrival) => arrival.routeId)).toEqual([OUTBOUND]);

    // The same pair the other way round must find the other direction, not this
    // one: a route that passes both stops in the wrong order is not an answer.
    const backwards = await http<ArrivalsResponse>(
      server.url,
      'GET',
      '/v1/arrivals?from=howrah&to=patuli',
    );
    expect(backwards.body.arrivals.map((arrival) => arrival.routeId)).toEqual([
      'ac24-howrah-patuli',
    ]);
  });

  it('answers with no arrival, rather than an error, when nothing is tracked', async () => {
    const result = await http<ArrivalsResponse>(server.url, 'GET', '/v1/arrivals?from=esplanade');
    expect(result.status).toBe(200);
    const arrival = result.body.arrivals.find((entry) => entry.routeId === OUTBOUND);
    expect(arrival?.journeyId).toBeNull();
    expect(arrival?.mode).toBeNull();
    expect(arrival?.arrival).toBeNull();
  });

  it('gives an arrival time for a live journey behind the stop', async () => {
    const gariahat = route.dto.stops.find((stop) => stop.id === 'gariahat')!;
    await journeyAt(gariahat.sM - 1200);

    const result = await http<ArrivalsResponse>(
      server.url,
      'GET',
      `/v1/arrivals?from=gariahat&routeId=${OUTBOUND}`,
    );
    expect(result.status).toBe(200);
    expect(result.body.arrivals).toHaveLength(1);

    const arrival = result.body.arrivals[0]!;
    expect(arrival.journeyId).not.toBeNull();
    expect(arrival.arrival?.etaSeconds).toBeGreaterThan(0);
    expect(arrival.arrival?.status).toBe('upcoming');
    expect(arrival.boardStopId).toBe('gariahat');
  });

  it('never reports a stop the bus has not reached as passed', async () => {
    const howrah = route.dto.stops.find((stop) => stop.id === 'howrah')!;
    await journeyAt(200);
    const result = await http<ArrivalsResponse>(
      server.url,
      'GET',
      `/v1/arrivals?from=howrah&routeId=${OUTBOUND}`,
    );
    const arrival = result.body.arrivals[0]!;
    expect(arrival.arrival?.status).not.toBe('passed');
    expect(arrival.arrival?.distanceM).toBeGreaterThan(howrah.sM - 1000);
    // The bus is before the first checkpoint, so nothing is behind it yet.
    expect(arrival.stopsAway).not.toBeNull();
  });

  it('rejects an unknown stop and an identical pair', async () => {
    const unknown = await http(server.url, 'GET', '/v1/arrivals?from=not-a-real-stop');
    expect(unknown.status).toBe(404);
    expect((unknown.body as { error: { code: string } }).error.code).toBe('STOP_NOT_FOUND');

    const same = await http(server.url, 'GET', '/v1/arrivals?from=howrah&to=howrah');
    expect(same.status).toBe(400);

    const missing = await http(server.url, 'GET', '/v1/arrivals');
    expect(missing.status).toBe(404);
  });

  it('accepts a displayed stop name as well as its key', async () => {
    const byName = await http<ArrivalsResponse>(
      server.url,
      'GET',
      `/v1/arrivals?from=${encodeURIComponent('Park Street')}`,
    );
    expect(byName.status).toBe(200);
    expect(byName.body.from.key).toBe('parkstreet');
  });

  it('does not let a long query string reach the directory scan', async () => {
    const long = await http(server.url, 'GET', `/v1/arrivals?from=${'a'.repeat(500)}`);
    expect(long.status).toBe(404);
  });
});
