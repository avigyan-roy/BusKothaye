import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_BATCH_REPORTS,
  type BoardJourneyResponse,
  type AccountRole,
  type AdminRouteListResponse,
  type AdminRouteRecord,
  type AuthSessionResponse,
  type CreateJourneyResponse,
  type DebugDto,
  type JoinJourneyResponse,
  type JourneyListResponse,
  type JourneyStateDto,
  type LocationResponse,
  type PreparedRoute,
  type RouteDto,
} from '@buskothay/shared';
import { http, loadAc24, reportAt, startTestServer, TEST_SIMULATOR_TOKEN, type TestServer } from './helpers.js';

/**
 * The HTTP surface, exercised through real requests against a real server.
 *
 * These are the behaviours that could mislead a passenger or hand someone
 * control they should not have, so they are tested end to end rather than by
 * calling handlers directly: runtime validation, privilege, the error contract
 * and the headers all take part.
 */

const ROUTE_ID = 'ac24-patuli-howrah';
let route: PreparedRoute;
let server: TestServer;
let accountCounter = 0;
const ownerTokens = new Map<string, string>();

beforeAll(async () => {
  route = await loadAc24();
});

beforeEach(async () => {
  server = await startTestServer();
  ownerTokens.clear();
});

afterEach(async () => {
  await server.close();
});

async function register(role: AccountRole): Promise<string> {
  accountCounter += 1;
  const result = await http<AuthSessionResponse>(server.url, 'POST', '/v1/auth/register', {
    body: {
      username: `test-${role}-${accountCounter}`,
      password: 'correct horse battery staple',
      role,
    },
  });
  expect(result.status).toBe(201);
  return result.body.token;
}

async function loginAdmin(): Promise<string> {
  const result = await http<AuthSessionResponse>(server.url, 'POST', '/v1/auth/login', {
    body: { username: 'admin', password: 'admin' },
  });
  expect(result.status).toBe(200);
  expect(result.body.account.isAdmin).toBe(true);
  return result.body.token;
}

async function createJourney(isDemo = false): Promise<CreateJourneyResponse> {
  const ownerToken = await register('driver');
  let createToken = ownerToken;
  if (isDemo) {
    const enabled = await http(server.url, 'PUT', '/v1/demo', {
      token: await loginAdmin(),
      body: { enabled: true },
    });
    expect(enabled.status).toBe(200);
    createToken = TEST_SIMULATOR_TOKEN;
  }
  const created = await http<CreateJourneyResponse>(server.url, 'POST', '/v1/journeys', {
    token: createToken,
    body: { routeId: ROUTE_ID },
  });
  expect(created.status).toBe(201);
  ownerTokens.set(created.body.journeyId, createToken);
  return created.body;
}

async function report(
  journey: CreateJourneyResponse,
  token: string,
  seq: number,
  sM: number,
): Promise<LocationResponse> {
  const result = await http<LocationResponse>(
    server.url,
    'POST',
    `/v1/journeys/${journey.journeyId}/locations`,
    { token, body: reportAt(route, { seq, sM }) },
  );
  expect(result.status).toBe(202);
  return result.body;
}

// ---------------------------------------------------------------------------

describe('health and readiness', () => {
  it('reports liveness without touching storage', async () => {
    const result = await http<{ status: string }>(server.url, 'GET', '/health');
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('ok');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it('reports readiness without revealing internals', async () => {
    const result = await http<Record<string, unknown>>(server.url, 'GET', '/ready');
    expect(result.status).toBe(200);
    expect(Object.keys(result.body)).toEqual(['status']);
  });
});

describe('administrator and demo access', () => {
  it('bootstraps the local admin and keeps demo controls admin-only', async () => {
    const passenger = await register('passenger');
    const denied = await http(server.url, 'GET', '/v1/demo', { token: passenger });
    expect(denied.status).toBe(403);

    const admin = await loginAdmin();
    const allowed = await http<{ status: string }>(server.url, 'GET', '/v1/demo', {
      token: admin,
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.status).toBe('OFF');
  });

  it('never lets registration grant administrator access', async () => {
    accountCounter += 1;
    const registered = await http<AuthSessionResponse>(server.url, 'POST', '/v1/auth/register', {
      body: {
        username: `self-admin-${accountCounter}`,
        password: 'correct horse battery staple',
        role: 'passenger',
        isAdmin: true,
      },
    });
    expect(registered.status).toBe(201);
    expect(registered.body.account.isAdmin).toBe(false);
    const denied = await http(server.url, 'PUT', '/v1/demo', {
      token: registered.body.token,
      body: { enabled: true },
    });
    expect(denied.status).toBe(403);
  });
});

describe('routes', () => {
  it('serves the route with its provenance and an ETag on its version', async () => {
    const result = await http<RouteDto>(server.url, 'GET', `/v1/routes/${ROUTE_ID}`);
    expect(result.status).toBe(200);
    expect(result.body.code).toBe('AC24');
    expect(result.body.stops).toHaveLength(8);
    expect(result.body.provenance.isApproximateGeometry).toBe(true);
    expect(result.headers.get('etag')).toBe(`"${result.body.version}"`);
  });

  it('returns 404 for an unknown route', async () => {
    const result = await http<{ error: { code: string } }>(
      server.url,
      'GET',
      '/v1/routes/no-such-route',
    );
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('keeps the route editor admin-only and activates a validated revision', async () => {
    const passenger = await register('passenger');
    const denied = await http(server.url, 'GET', '/v1/admin/routes', { token: passenger });
    expect(denied.status).toBe(403);

    const admin = await loginAdmin();
    const listing = await http<AdminRouteListResponse>(server.url, 'GET', '/v1/admin/routes', {
      token: admin,
    });
    expect(listing.status).toBe(200);
    const ac24 = listing.body.routes.find((record) => record.route.id === ROUTE_ID);
    expect(ac24).toBeDefined();

    const edited = structuredClone(ac24!.route);
    edited.version = 'test-admin-revision-1';
    edited.schedule = {
      source: 'API route editor test',
      timezone: edited.timezone,
      isIllustrative: true,
      departures: ['06:30'],
    };
    const saved = await http<AdminRouteRecord>(
      server.url,
      'PUT',
      `/v1/admin/routes/${ROUTE_ID}`,
      { token: admin, body: { route: edited } },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.updatedBy).toBe('admin');

    const publicRoute = await http<RouteDto>(server.url, 'GET', `/v1/routes/${ROUTE_ID}`);
    expect(publicRoute.body.version).toBe('test-admin-revision-1');
    expect(publicRoute.body.schedule?.source).toBe('API route editor test');
    expect(await server.repo.listRouteOverrides()).toHaveLength(1);
  });
});

describe('the full contributor path', () => {
  it('creates, reports, reads and ends a journey', async () => {
    const journey = await createJourney();
    expect(journey.role).toBe('driver');
    expect(journey.joinCode).toMatch(/^BUS-[A-Z0-9]{6}$/);

    const pending = await http<JourneyStateDto>(
      server.url,
      'GET',
      `/v1/journeys/${journey.journeyId}/state`,
    );
    expect(pending.body.mode).toBe('PENDING');
    expect(pending.body.position).toBeNull();
    expect(pending.headers.get('cache-control')).toBe('no-store');

    const accepted = await report(journey, journey.contributorToken, 0, 400);
    expect(accepted.results[0]!.accepted).toBe(true);

    const live = await http<JourneyStateDto>(
      server.url,
      'GET',
      `/v1/journeys/${journey.journeyId}/state`,
    );
    expect(live.body.mode).toBe('LIVE');
    expect(live.body.position).not.toBeNull();
    expect(live.body.isDemo).toBe(false);

    const ended = await http<{ mode: string }>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/end`,
      { token: ownerTokens.get(journey.journeyId) },
    );
    expect(ended.status).toBe(200);
    expect(ended.body.mode).toBe('ENDED');
  });

  it('lets a joiner contribute and revoke itself', async () => {
    const journey = await createJourney();
    const joined = await http<JoinJourneyResponse>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/contributors`,
      { token: await register('passenger'), body: { joinCode: journey.joinCode, role: 'passenger' } },
    );
    expect(joined.status).toBe(201);
    expect(joined.body.role).toBe('passenger');

    await report(journey, joined.body.contributorToken, 0, 300);

    const revoked = await http(
      server.url,
      'DELETE',
      `/v1/journeys/${journey.journeyId}/contributors/me`,
      { token: joined.body.contributorToken },
    );
    expect(revoked.status).toBe(200);

    // The capability is gone; further reports are unauthenticated.
    const after = await http(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/locations`,
      { token: joined.body.contributorToken, body: reportAt(route, { seq: 1, sM: 400 }) },
    );
    expect(after.status).toBe(401);
  });

  it('lets a passenger board only while confirmed at the selected stop', async () => {
    const journey = await createJourney();
    const ruby = route.dto.stops.find((stop) => stop.id === 'ruby')!;
    await report(journey, journey.contributorToken, 0, ruby.sM);

    const state = await http<JourneyStateDto>(
      server.url,
      'GET',
      `/v1/journeys/${journey.journeyId}/state`,
    );
    expect(state.body.boardableStopId).toBe('ruby');

    const passenger = await register('passenger');
    const wrongStop = await http(server.url, 'POST', `/v1/journeys/${journey.journeyId}/board`, {
      token: passenger,
      body: { stopId: 'gariahat' },
    });
    expect(wrongStop.status).toBe(409);

    const boarded = await http<BoardJourneyResponse>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/board`,
      {
        token: passenger,
        body: { stopId: 'ruby' },
        headers: { 'idempotency-key': `board-${accountCounter}` },
      },
    );
    expect(boarded.status).toBe(201);
    expect(boarded.body.role).toBe('passenger');
    expect(boarded.body.boardedStopId).toBe('ruby');

    const upload = await http(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/locations`,
      {
        token: boarded.body.contributorToken,
        body: reportAt(route, { seq: boarded.body.nextSeq, sM: ruby.sM }),
      },
    );
    expect(upload.status).toBe(202);
  });

  it('refuses boarding to unauthenticated and non-passenger accounts', async () => {
    const journey = await createJourney();
    const patuli = route.dto.stops[0]!;
    await report(journey, journey.contributorToken, 0, patuli.sM);

    const anonymous = await http(server.url, 'POST', `/v1/journeys/${journey.journeyId}/board`, {
      body: { stopId: patuli.id },
    });
    expect(anonymous.status).toBe(401);

    const driver = await register('driver');
    const forbidden = await http(server.url, 'POST', `/v1/journeys/${journey.journeyId}/board`, {
      token: driver,
      body: { stopId: patuli.id },
    });
    expect(forbidden.status).toBe(403);
  });

  it('normalises a join code typed in lower case with spaces', async () => {
    const journey = await createJourney();
    const messy = journey.joinCode.toLowerCase().replace('-', ' ');
    const joined = await http(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/contributors`,
      { token: await register('conductor'), body: { joinCode: ` ${messy} `, role: 'conductor' } },
    );
    expect(joined.status).toBe(201);
  });
});

describe('privilege', () => {
  it('will not issue a driver capability through a join body', async () => {
    const journey = await createJourney();
    const result = await http<{ error: { code: string } }>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/contributors`,
      { body: { joinCode: journey.joinCode, role: 'driver' } },
    );
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a wrong join code and does not say whether one exists', async () => {
    const journey = await createJourney();
    const result = await http<{ error: { code: string; message: string } }>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/contributors`,
      { token: await register('passenger'), body: { joinCode: 'BUS-ZZZZZZ', role: 'passenger' } },
    );
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('JOIN_CODE_INVALID');
    expect(result.body.error.message).not.toMatch(/hash|token/i);
  });

  it('does not let a passenger end the journey', async () => {
    const journey = await createJourney();
    const passengerToken = await register('passenger');
    await http<JoinJourneyResponse>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/contributors`,
      { token: passengerToken, body: { joinCode: journey.joinCode, role: 'passenger' } },
    );
    const result = await http<{ error: { code: string } }>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/end`,
      { token: passengerToken },
    );
    expect(result.status).toBe(403);
    expect(result.body.error.code).toBe('FORBIDDEN');
  });

  it('does not let the read-only ops capability report or end', async () => {
    const journey = await createJourney();

    const posted = await http(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/locations`,
      { token: journey.opsToken, body: reportAt(route, { seq: 0, sM: 100 }) },
    );
    expect(posted.status).toBe(401);

    const ended = await http(server.url, 'POST', `/v1/journeys/${journey.journeyId}/end`, {
      token: journey.opsToken,
    });
    expect(ended.status).toBe(401);
  });

  it('protects diagnostics, including for a demo journey', async () => {
    const journey = await createJourney(true);

    const anonymous = await http<{ error: { code: string } }>(
      server.url,
      'GET',
      `/v1/journeys/${journey.journeyId}/debug`,
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

    const wrong = await http(server.url, 'GET', `/v1/journeys/${journey.journeyId}/debug`, {
      token: 'not-a-real-token',
    });
    expect(wrong.status).toBe(401);

    const allowed = await http<DebugDto>(
      server.url,
      'GET',
      `/v1/journeys/${journey.journeyId}/debug`,
      { token: journey.opsToken },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body.journeyId).toBe(journey.journeyId);
  });
});

describe('public payloads', () => {
  it('contain no contributor identifiers, capabilities or hashes', async () => {
    const journey = await createJourney();
    await http(server.url, 'POST', `/v1/journeys/${journey.journeyId}/contributors`, {
      token: await register('conductor'),
      body: { joinCode: journey.joinCode, role: 'conductor' },
    });
    await report(journey, journey.contributorToken, 0, 500);

    const state = await http<JourneyStateDto>(
      server.url,
      'GET',
      `/v1/journeys/${journey.journeyId}/state`,
    );
    const serialised = JSON.stringify(state.body);

    for (const secret of [
      journey.contributorToken,
      journey.opsToken,
      journey.joinCode,
      journey.contributorId,
    ]) {
      expect(serialised).not.toContain(secret);
    }
    expect(serialised).not.toMatch(/tokenHash|joinCodeHash|opsTokenHash/);
    // Aggregate counts are public; the sources behind them are not.
    expect(state.body.activeSources.driver).toBe(true);
  });

  it('lists journeys without leaking anything privileged', async () => {
    const journey = await createJourney();
    const list = await http<JourneyListResponse>(
      server.url,
      'GET',
      `/v1/routes/${ROUTE_ID}/journeys`,
    );
    expect(list.body.journeys.some((j) => j.journeyId === journey.journeyId)).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(journey.joinCode);
  });
});

describe('input validation and limits', () => {
  it('rejects a malformed body rather than pretending to accept it', async () => {
    const journey = await createJourney();
    const result = await http<{ error: { code: string } }>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/locations`,
      { token: journey.contributorToken, body: { seq: -1, lat: 'north', lon: null } },
    );
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an unauthenticated report with 401, not a fake acceptance', async () => {
    const journey = await createJourney();
    const result = await http(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/locations`,
      { body: reportAt(route, { seq: 0, sM: 100 }) },
    );
    expect(result.status).toBe(401);
  });

  it('rejects an oversized batch', async () => {
    const journey = await createJourney();
    const updates = Array.from({ length: MAX_BATCH_REPORTS + 5 }, (_, i) =>
      reportAt(route, { seq: i, sM: i * 10 }),
    );
    const result = await http<{ error: { code: string } }>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/locations`,
      { token: journey.contributorToken, body: { updates } },
    );
    expect(result.status).toBe(400);
  });

  it('rejects a body larger than the documented limit', async () => {
    const journey = await createJourney();
    const response = await fetch(
      `${server.url}/v1/journeys/${journey.journeyId}/locations`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${journey.contributorToken}`,
        },
        body: JSON.stringify({ padding: 'x'.repeat(80 * 1024) }),
      },
    );
    expect(response.status).toBe(413);
  });

  it('returns 404 for an unknown journey', async () => {
    const result = await http<{ error: { code: string } }>(
      server.url,
      'GET',
      '/v1/journeys/j_missing/state',
    );
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe('JOURNEY_NOT_FOUND');
  });

  it('returns 410 for a write to an ended journey', async () => {
    const journey = await createJourney();
    await http(server.url, 'POST', `/v1/journeys/${journey.journeyId}/end`, {
      token: ownerTokens.get(journey.journeyId),
    });
    const result = await http<{ error: { code: string } }>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/locations`,
      { token: journey.contributorToken, body: reportAt(route, { seq: 0, sM: 100 }) },
    );
    expect(result.status).toBe(410);
    expect(result.body.error.code).toBe('JOURNEY_ENDED');
  });

  it('rate limits journey creation and says when to retry', async () => {
    const results = [];
    const token = await register('driver');
    for (let i = 0; i < 12; i += 1) {
      results.push(
        await http<{ error?: { code: string } }>(server.url, 'POST', '/v1/journeys', {
          token,
          body: { routeId: ROUTE_ID },
        }),
      );
    }
    const limited = results.find((r) => r.status === 429);
    expect(limited).toBeDefined();
    expect(limited!.headers.get('retry-after')).not.toBeNull();
  });
});

describe('duplicate and out-of-order handling', () => {
  it('does not assimilate the same report twice', async () => {
    const journey = await createJourney();
    await report(journey, journey.contributorToken, 5, 800);

    const replay = await report(journey, journey.contributorToken, 5, 3000);
    expect(replay.results[0]!.accepted).toBe(false);
    expect(replay.results[0]!.reason).toBe('DUPLICATE');

    const state = await http<JourneyStateDto>(
      server.url,
      'GET',
      `/v1/journeys/${journey.journeyId}/state`,
    );
    expect(state.body.lastConfirmedPosition!.sM).toBeLessThan(1000);
  });

  it('keeps only the newest report in a batch for live state', async () => {
    const journey = await createJourney();
    const result = await http<LocationResponse>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/locations`,
      {
        token: journey.contributorToken,
        body: {
          updates: [
            reportAt(route, { seq: 0, sM: 100 }),
            reportAt(route, { seq: 1, sM: 200 }),
            reportAt(route, { seq: 2, sM: 300 }),
          ],
        },
      },
    );
    expect(result.body.results.filter((r) => r.accepted)).toHaveLength(1);
    expect(result.body.results.filter((r) => r.historyOnly)).toHaveLength(2);
  });
});

describe('idempotency', () => {
  it('creates at most one journey for a repeated key', async () => {
    const key = 'test-key-create';
    const token = await register('driver');
    const first = await http<CreateJourneyResponse>(server.url, 'POST', '/v1/journeys', {
      token,
      body: { routeId: ROUTE_ID },
      headers: { 'idempotency-key': key },
    });
    expect(first.status).toBe(201);

    const replay = await http<{ error: { code: string; fields?: { path: string; reason: string }[] } }>(
      server.url,
      'POST',
      '/v1/journeys',
      { token, body: { routeId: ROUTE_ID }, headers: { 'idempotency-key': key } },
    );
    // The documented conflict path: the capabilities were shown once and cannot
    // be reissued, so a replay points at the existing journey instead of quietly
    // minting a second set.
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('CAPABILITY_RESPONSE_UNAVAILABLE');
    expect(replay.body.error.fields?.[0]?.reason).toBe(first.body.journeyId);
  });

  it('creates at most one journey when the same key is used concurrently', async () => {
    const key = 'test-key-concurrent';
    const token = await register('driver');
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        http<CreateJourneyResponse>(server.url, 'POST', '/v1/journeys', {
          token,
          body: { routeId: ROUTE_ID },
          headers: { 'idempotency-key': key },
        }),
      ),
    );
    // Exactly one resource, and nothing that is neither a success nor a
    // documented refusal. (Creation is also rate limited, so some of the losers
    // may be turned away with 429 rather than 409 — both are honest answers, and
    // neither creates a second journey.)
    expect(attempts.filter((a) => a.status === 201)).toHaveLength(1);
    expect(attempts.every((a) => [201, 409, 429].includes(a.status))).toBe(true);

    const list = await http<JourneyListResponse>(
      server.url,
      'GET',
      `/v1/routes/${ROUTE_ID}/journeys`,
    );
    expect(list.body.journeys).toHaveLength(1);
  });

  it('creates at most one contributor for a repeated join key', async () => {
    const journey = await createJourney();
    const key = 'test-key-join';
    const first = await http<JoinJourneyResponse>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/contributors`,
      { token: await register('passenger'), body: { joinCode: journey.joinCode, role: 'passenger' }, headers: { 'idempotency-key': key } },
    );
    expect(first.status).toBe(201);

    const replay = await http(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/contributors`,
      { token: await register('passenger'), body: { joinCode: journey.joinCode, role: 'passenger' }, headers: { 'idempotency-key': key } },
    );
    expect(replay.status).toBe(409);
  });
});

describe('concurrency', () => {
  it('keeps state consistent when several contributors report at once', async () => {
    const journey = await createJourney();
    const passengerToken = await register('passenger');
    const joiners = await Promise.all(
      Array.from({ length: 3 }, () =>
        http<JoinJourneyResponse>(
          server.url,
          'POST',
          `/v1/journeys/${journey.journeyId}/contributors`,
          { token: passengerToken, body: { joinCode: journey.joinCode, role: 'passenger' } },
        ),
      ),
    );

    const responses = await Promise.all(
      joiners.map((joined, index) =>
        http<LocationResponse>(
          server.url,
          'POST',
          `/v1/journeys/${journey.journeyId}/locations`,
          {
            token: joined.body.contributorToken,
            body: reportAt(route, { seq: 0, sM: 500 + index * 10 }),
          },
        ),
      ),
    );

    // Every accepted response must correspond to a committed version; no
    // last-writer-wins overwrite is allowed to silently drop one.
    const versions = responses.map((r) => r.body.stateVersion);
    expect(new Set(versions).size).toBe(versions.length);

    const state = await http<JourneyStateDto>(
      server.url,
      'GET',
      `/v1/journeys/${journey.journeyId}/state`,
    );
    expect(state.body.stateVersion).toBeGreaterThanOrEqual(Math.max(...versions));
    expect(state.body.mode).toBe('LIVE');
  });

  it('rechecks permission after losing a race to an end', async () => {
    const journey = await createJourney();
    const joined = await http<JoinJourneyResponse>(
      server.url,
      'POST',
      `/v1/journeys/${journey.journeyId}/contributors`,
      { token: await register('passenger'), body: { joinCode: journey.joinCode, role: 'passenger' } },
    );

    const [, late] = await Promise.all([
      http(server.url, 'POST', `/v1/journeys/${journey.journeyId}/end`, {
        token: ownerTokens.get(journey.journeyId),
      }),
      http(server.url, 'POST', `/v1/journeys/${journey.journeyId}/locations`, {
        token: joined.body.contributorToken,
        body: reportAt(route, { seq: 0, sM: 600 }),
      }),
    ]);

    // Either the report landed before the end or it was refused; what must not
    // happen is a report being accepted into an ended journey.
    expect([202, 410]).toContain(late.status);
    const state = await http<JourneyStateDto>(
      server.url,
      'GET',
      `/v1/journeys/${journey.journeyId}/state`,
    );
    expect(state.body.mode).toBe('ENDED');
  });
});

describe('expiry', () => {
  it('drops an expired journey from the active list without a cleanup timer', async () => {
    const journey = await createJourney();
    const snapshot = await server.repo.getJourney(journey.journeyId);
    // Age the journey by rewriting its creation time; nothing sweeps it, so the
    // list query has to notice on its own.
    await server.repo.putJourney(
      { ...snapshot!, createdAtMs: Date.now() - 10 * 60 * 1000, version: snapshot!.version + 1 },
      snapshot!.version,
    );

    const list = await http<JourneyListResponse>(
      server.url,
      'GET',
      `/v1/routes/${ROUTE_ID}/journeys`,
    );
    expect(list.body.journeys.some((j) => j.journeyId === journey.journeyId)).toBe(false);

    const state = await http<JourneyStateDto>(
      server.url,
      'GET',
      `/v1/journeys/${journey.journeyId}/state`,
    );
    expect(state.body.mode).toBe('ENDED');
  });
});

describe('cross-origin', () => {
  it('allows the configured web origin and no other', async () => {
    const allowed = await http(server.url, 'GET', `/v1/routes/${ROUTE_ID}`, {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    const denied = await http(server.url, 'GET', `/v1/routes/${ROUTE_ID}`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});
