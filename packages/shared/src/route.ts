import {
  interpolateAt,
  preparePolyline,
  projectToPolyline,
  type LonLat,
  type PreparedPolyline,
} from '@buskothay/geometry';
import type { RouteDto, RouteFixture, RouteSegment, RouteStop } from './schemas/route.js';
import { RouteDtoSchema, RouteFixtureSchema } from './schemas/route.js';
import { SCHEMA_VERSION } from './constants.js';

/** How far a checkpoint may sit from the drawn line before the fixture is wrong. */
export const STOP_ON_ROUTE_TOLERANCE_M = 30;

/** A route plus the precomputed polyline everything else projects against. */
export interface PreparedRoute {
  readonly dto: RouteDto;
  readonly line: PreparedPolyline;
}

export class RouteValidationError extends Error {
  constructor(
    message: string,
    readonly problems: string[],
  ) {
    super(message);
    this.name = 'RouteValidationError';
  }
}

/**
 * Turn a committed fixture into the DTO the API serves.
 *
 * Cumulative distances and route length are derived here, never authored by
 * hand, so a coordinate edit cannot leave the stop distances quietly wrong. Stop
 * `sM` values present in the fixture are treated as a cross-check, not as truth.
 */
export function prepareRoute(fixtureInput: unknown): PreparedRoute {
  const fixture: RouteFixture = RouteFixtureSchema.parse(fixtureInput);
  const coordinates = fixture.geometry.coordinates as unknown as LonLat[];
  const line = preparePolyline(coordinates);

  const problems: string[] = [];
  const stops: RouteStop[] = [];

  for (const stop of fixture.stops) {
    const projected = projectToPolyline(line, stop.lon, stop.lat);
    if (projected === null) {
      problems.push(`Stop "${stop.id}" could not be projected onto the route`);
      continue;
    }
    if (projected.offsetM > STOP_ON_ROUTE_TOLERANCE_M) {
      problems.push(
        `Stop "${stop.id}" is ${projected.offsetM.toFixed(0)} m from the route line ` +
          `(tolerance ${STOP_ON_ROUTE_TOLERANCE_M} m)`,
      );
    }
    if (typeof stop.sM === 'number' && Math.abs(stop.sM - projected.sM) > 50) {
      problems.push(
        `Stop "${stop.id}" has an authored sM of ${stop.sM} but projects to ` +
          `${projected.sM.toFixed(0)}; remove the authored value or fix the geometry`,
      );
    }
    stops.push({
      id: stop.id,
      name: stop.name,
      lat: stop.lat,
      lon: stop.lon,
      sM: projected.sM,
      isSelectedCheckpoint: stop.isSelectedCheckpoint,
    });
  }

  stops.sort((a, b) => a.sM - b.sM);
  for (let i = 1; i < stops.length; i += 1) {
    if (stops[i]!.sM <= stops[i - 1]!.sM) {
      problems.push(
        `Stops "${stops[i - 1]!.id}" and "${stops[i]!.id}" project to the same or ` +
          'decreasing distance along the route',
      );
    }
  }

  const authoredOrder = fixture.stops.map((s) => s.id).join(',');
  const projectedOrder = stops.map((s) => s.id).join(',');
  if (authoredOrder !== projectedOrder) {
    problems.push(
      `Checkpoint order along the geometry (${projectedOrder}) does not match the ` +
        `order in the fixture (${authoredOrder})`,
    );
  }

  // Segments are authored between checkpoints; derive their distances here so the
  // speed table always matches the geometry it describes.
  const stopById = new Map(stops.map((s) => [s.id, s]));
  const segments: RouteSegment[] = [];
  for (const authored of fixture.segments) {
    const from = stopById.get(authored.fromStopId);
    const to = stopById.get(authored.toStopId);
    if (!from || !to) {
      problems.push(
        `Segment ${authored.fromStopId}→${authored.toStopId} references an unknown stop`,
      );
      continue;
    }
    if (to.sM <= from.sM) {
      problems.push(
        `Segment ${authored.fromStopId}→${authored.toStopId} is empty or runs backwards`,
      );
      continue;
    }
    segments.push({
      fromSM: from.sM,
      toSM: to.sM,
      typicalSpeedMps: authored.typicalSpeedMps,
      dwellAllowanceS: authored.dwellAllowanceS,
      ...(authored.note === undefined ? {} : { note: authored.note }),
    });
  }
  segments.sort((a, b) => a.fromSM - b.fromSM);
  if (segments.length > 0) {
    for (let i = 1; i < segments.length; i += 1) {
      if (Math.abs(segments[i]!.fromSM - segments[i - 1]!.toSM) > 1) {
        problems.push(
          `Segments leave a gap or overlap at ${segments[i - 1]!.toSM.toFixed(0)} m`,
        );
      }
    }
    // Extend the terminal segments to the physical ends of the line so that every
    // distance on the route has an authored typical speed.
    segments[0] = { ...segments[0]!, fromSM: 0 };
    segments[segments.length - 1] = {
      ...segments[segments.length - 1]!,
      toSM: line.lengthM,
    };
  } else {
    problems.push('The route has no usable segments');
  }

  if (fixture.schedule && fixture.schedule.isIllustrative === false) {
    if (fixture.schedule.departures.length === 0) {
      problems.push('A non-illustrative schedule must list departures');
    }
  }

  if (problems.length > 0) {
    throw new RouteValidationError(
      `Route "${fixture.id}" failed validation`,
      problems,
    );
  }

  const dto = RouteDtoSchema.parse({
    ...fixture,
    schemaVersion: SCHEMA_VERSION,
    lengthM: line.lengthM,
    stops,
    segments,
  } satisfies Record<string, unknown>);

  return { dto, line };
}

/** Rebuild the polyline for a DTO that arrived over the wire. */
export function prepareFromDto(dto: RouteDto): PreparedRoute {
  return {
    dto,
    line: preparePolyline(dto.geometry.coordinates as unknown as LonLat[]),
  };
}

/** Authored typical speed covering a distance, falling back to the route mean. */
export function segmentTypicalSpeedMps(route: RouteDto, sM: number): number {
  const segment = route.segments.find((s) => sM >= s.fromSM && sM < s.toSM);
  if (segment) return segment.typicalSpeedMps;
  const last = route.segments[route.segments.length - 1];
  return last ? last.typicalSpeedMps : 6;
}

/** Mean authored speed between two distances, weighted by the length in each segment. */
export function meanSegmentSpeedMps(route: RouteDto, fromSM: number, toSM: number): number {
  const lo = Math.min(fromSM, toSM);
  const hi = Math.max(fromSM, toSM);
  if (hi - lo < 1) return segmentTypicalSpeedMps(route, lo);
  let weighted = 0;
  let covered = 0;
  for (const segment of route.segments) {
    const overlap = Math.min(hi, segment.toSM) - Math.max(lo, segment.fromSM);
    if (overlap <= 0) continue;
    weighted += overlap * segment.typicalSpeedMps;
    covered += overlap;
  }
  if (covered <= 0) return segmentTypicalSpeedMps(route, lo);
  return weighted / covered;
}

/** Dwell allowance authored for the stretch between two distances, seconds. */
export function segmentDwellAllowanceS(
  route: RouteDto,
  fromSM: number,
  toSM: number,
): number {
  const lo = Math.min(fromSM, toSM);
  const hi = Math.max(fromSM, toSM);
  let total = 0;
  for (const segment of route.segments) {
    const overlap = Math.min(hi, segment.toSM) - Math.max(lo, segment.fromSM);
    if (overlap <= 0) continue;
    const span = segment.toSM - segment.fromSM;
    total += segment.dwellAllowanceS * (span > 0 ? overlap / span : 1);
  }
  return total;
}

/** The first stop strictly ahead of `sM`, or null at the end of the route. */
export function nextStopAfter(route: RouteDto, sM: number): RouteStop | null {
  for (const stop of route.stops) {
    if (stop.sM > sM) return stop;
  }
  return null;
}

/** Stops strictly between two distances, used for the ETA dwell allowance. */
export function stopsBetween(route: RouteDto, fromSM: number, toSM: number): RouteStop[] {
  return route.stops.filter((stop) => stop.sM > fromSM && stop.sM < toSM);
}

/** Coordinate at a distance along a prepared route. */
export function positionAt(prepared: PreparedRoute, sM: number): { lat: number; lon: number } {
  const [lon, lat] = interpolateAt(prepared.line, sM);
  return { lat, lon };
}
