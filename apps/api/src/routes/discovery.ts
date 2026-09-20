import { Router } from 'express';
import {
  SCHEMA_VERSION,
  stopKey,
  type Arrival,
  type DirectoryStop,
  type StopEta,
  type StopRouteRef,
} from '@buskothay/shared';
import { ApiProblem, badRequest } from '../http/errors.js';
import type { JourneyService } from '../service/journey-service.js';
import type { RouteRegistry } from './route-registry.js';

/**
 * Stop-first discovery: the two questions a passenger actually asks.
 *
 *   "Which bus gets me from here to there, and when?"   → /arrivals?from&to
 *   "When does this bus reach me?"                      → /arrivals?from&routeId
 *
 * Both are the same computation, so they are the same endpoint with a different
 * filter. Doing it on the server rather than in the browser is what stops the
 * passenger app from holding its own opinion about which routes exist, which
 * stops they call at, or how far away the bus is — the browser asks a question
 * and renders the answer.
 */

/** A results board with more rows than this is not a useful answer to anybody. */
const MAX_ARRIVALS = 25;

export function createDiscoveryRouter(
  registry: RouteRegistry,
  service: JourneyService,
  nowMs: () => number,
): Router {
  const router = Router();

  router.get('/stops', (_req, res) => {
    const stops = registry.stopDirectory();
    // Stops change only when a route revision is published, and every response
    // is small, so a short shared cache is safe. Arrivals below are never cached.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ schemaVersion: SCHEMA_VERSION, stops });
  });

  router.get('/arrivals', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const directory = registry.stopDirectory();

    const from = findStop(directory, req.query.from);
    if (from === null) {
      throw new ApiProblem(404, 'STOP_NOT_FOUND', 'That stop is not on any tracked route.');
    }
    const toRaw = singleParam(req.query.to);
    const to = toRaw === null ? null : findStop(directory, toRaw);
    if (toRaw !== null && to === null) {
      throw new ApiProblem(404, 'STOP_NOT_FOUND', 'That destination is not on any tracked route.');
    }
    if (to !== null && to.key === from.key) {
      throw badRequest('Choose two different stops.');
    }

    const routeFilter = singleParam(req.query.routeId);
    if (routeFilter !== null && !registry.has(routeFilter)) {
      throw new ApiProblem(404, 'ROUTE_NOT_FOUND', 'No such route.');
    }

    const candidates = from.routes
      .filter((ref) => routeFilter === null || ref.routeId === routeFilter)
      .filter((ref) => to === null || servesJourney(ref, to))
      .slice(0, MAX_ARRIVALS);

    const arrivals = await Promise.all(
      candidates.map((ref) => arrivalFor(service, ref, from, to)),
    );

    res.json({
      schemaVersion: SCHEMA_VERSION,
      serverTs: nowMs(),
      from: { key: from.key, name: from.name },
      to: to === null ? null : { key: to.key, name: to.name },
      arrivals: arrivals.sort(byNearestArrival),
    });
  });

  return router;
}

/** True when this route reaches the destination *after* the boarding stop. */
function servesJourney(ref: StopRouteRef, to: DirectoryStop): boolean {
  const destination = to.routes.find((candidate) => candidate.routeId === ref.routeId);
  return destination !== undefined && destination.sequence > ref.sequence;
}

async function arrivalFor(
  service: JourneyService,
  ref: StopRouteRef,
  from: DirectoryStop,
  to: DirectoryStop | null,
): Promise<Arrival> {
  const alight = to?.routes.find((candidate) => candidate.routeId === ref.routeId) ?? null;
  const base = {
    routeId: ref.routeId,
    code: ref.code,
    color: ref.color,
    name: ref.name,
    origin: ref.origin,
    destination: ref.destination,
    direction: ref.direction,
    boardStopId: ref.stopId,
    boardStopName: from.name,
    alightStopId: alight?.stopId ?? null,
    alightStopName: alight === null ? null : (to?.name ?? null),
  };

  // A storage blip on one route must not fail the whole board; that route says
  // "not tracked right now", which is what the passenger would see anyway.
  const state = await service.bestState(ref.routeId).catch(() => null);
  if (state === null) {
    return {
      ...base,
      routeVersion: '',
      journeyId: null,
      isDemo: false,
      mode: null,
      arrival: null,
      lastFixAgeSeconds: null,
      currentStopName: null,
      stopsAway: null,
    };
  }

  const arrival = state.stops.find((stop) => stop.stopId === ref.stopId) ?? null;
  const busIndex = busStopIndex(state.stops);
  const boardIndex = state.stops.findIndex((stop) => stop.stopId === ref.stopId);
  return {
    ...base,
    routeVersion: state.routeVersion,
    journeyId: state.journeyId,
    isDemo: state.isDemo,
    mode: state.mode,
    arrival,
    lastFixAgeSeconds: state.lastFixAgeSeconds,
    currentStopName: busIndex === null ? null : (state.stops[busIndex]?.name ?? null),
    stopsAway:
      busIndex === null || boardIndex < 0 ? null : Math.max(0, boardIndex - busIndex),
  };
}

/**
 * The stop the bus is at, or the last one it has been confirmed past.
 *
 * "near" outranks "passed" because a bus standing at a stop has not passed it
 * yet, and saying it has would move the bus forward on the strength of nothing.
 */
function busStopIndex(stops: readonly StopEta[]): number | null {
  let lastPassed: number | null = null;
  for (let index = 0; index < stops.length; index += 1) {
    const status = stops[index]?.status;
    if (status === 'near') return index;
    if (status === 'passed') lastPassed = index;
  }
  return lastPassed;
}

/** Soonest first; a route with no tracked bus sorts last but is still listed. */
function byNearestArrival(a: Arrival, b: Arrival): number {
  const left = a.arrival?.etaSeconds ?? Number.POSITIVE_INFINITY;
  const right = b.arrival?.etaSeconds ?? Number.POSITIVE_INFINITY;
  if (left !== right) return left - right;
  return a.code.localeCompare(b.code);
}

function singleParam(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Long enough for any real stop or route ID, short enough that a pathological
  // query string never reaches the directory scan below.
  return trimmed.length === 0 || trimmed.length > 120 ? null : trimmed;
}

/** Accepts either the directory key or the stop's displayed name. */
function findStop(directory: readonly DirectoryStop[], raw: unknown): DirectoryStop | null {
  const value = singleParam(raw);
  if (value === null) return null;
  const key = stopKey(value);
  if (key.length === 0) return null;
  return directory.find((stop) => stop.key === key) ?? null;
}
