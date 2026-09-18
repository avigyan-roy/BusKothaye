import type { LonLat, PreparedPolyline, Projection, SearchWindowM } from './types.js';
import {
  haversineMetres,
  metresPerDegreeLatitude,
  metresPerDegreeLongitude,
} from './units.js';

/**
 * Prepare a polyline for projection by precomputing cumulative distances.
 *
 * Throws on input that would silently produce nonsense later: fewer than two
 * points, non-finite coordinates, or out-of-range degrees. Zero-length segments
 * (a repeated coordinate) are tolerated — they contribute no distance and are
 * skipped during projection — because exported road geometry often contains them.
 */
export function preparePolyline(points: readonly LonLat[]): PreparedPolyline {
  if (points.length < 2) {
    throw new Error('A polyline needs at least two points');
  }
  const cumulativeM: number[] = new Array<number>(points.length);
  cumulativeM[0] = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const [lon, lat] = p;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`Point ${i} has a non-finite coordinate`);
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error(`Point ${i} is outside the valid coordinate range`);
    }
    if (i > 0) {
      const prev = points[i - 1]!;
      cumulativeM[i] = cumulativeM[i - 1]! + haversineMetres(prev[0], prev[1], lon, lat);
    }
  }
  return {
    points,
    cumulativeM,
    lengthM: cumulativeM[cumulativeM.length - 1]!,
  };
}

interface SegmentMatch {
  /** Fraction along the segment, clamped to [0, 1]. */
  readonly t: number;
  /** Perpendicular distance in metres. */
  readonly distanceM: number;
}

/**
 * Closest point on segment A→B to point P, in metres.
 *
 * Converts to a local east/north plane centred on A before doing any arithmetic.
 * Over a segment of a few hundred metres the distortion of that plane is far
 * below GPS noise, and it keeps the maths to one dot product.
 */
export function pointToSegment(p: LonLat, a: LonLat, b: LonLat): SegmentMatch {
  const mPerLat = metresPerDegreeLatitude(a[1]);
  const mPerLon = metresPerDegreeLongitude(a[1]);

  const px = (p[0] - a[0]) * mPerLon;
  const py = (p[1] - a[1]) * mPerLat;
  const bx = (b[0] - a[0]) * mPerLon;
  const by = (b[1] - a[1]) * mPerLat;

  const segLenSq = bx * bx + by * by;
  if (segLenSq === 0) {
    // Degenerate segment: the closest point is the shared endpoint.
    return { t: 0, distanceM: Math.hypot(px, py) };
  }
  const tRaw = (px * bx + py * by) / segLenSq;
  const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
  const dx = px - t * bx;
  const dy = py - t * by;
  return { t, distanceM: Math.hypot(dx, dy) };
}

/**
 * Project a coordinate onto the polyline, optionally restricted to a window of
 * along-route distance.
 *
 * The window is not an optimisation, it is a correctness requirement: a route
 * that runs near itself maps one coordinate to several valid distances, and an
 * unwindowed search will teleport the vehicle. Callers derive the window from
 * elapsed time and a plausible maximum speed rather than a fixed span, so a bus
 * that reappears after a long outage is still inside the search.
 *
 * Returns `null` when the window excludes every segment, which the caller should
 * treat as "no plausible match", not as distance zero.
 */
export function projectToPolyline(
  line: PreparedPolyline,
  lon: number,
  lat: number,
  window?: SearchWindowM,
): Projection | null {
  const minSM = window ? Math.max(0, window.minSM) : 0;
  const maxSM = window ? Math.min(line.lengthM, window.maxSM) : line.lengthM;
  if (maxSM < minSM) return null;

  let best: Projection | null = null;
  for (let i = 0; i < line.points.length - 1; i += 1) {
    const segStart = line.cumulativeM[i]!;
    const segEnd = line.cumulativeM[i + 1]!;
    if (segEnd < minSM || segStart > maxSM) continue;

    const match = pointToSegment([lon, lat], line.points[i]!, line.points[i + 1]!);
    if (best !== null && match.distanceM >= best.offsetM) continue;

    const segLenM = segEnd - segStart;
    const sM = segStart + match.t * segLenM;
    best = { sM, offsetM: match.distanceM, segmentIndex: i };
  }

  if (best === null) return null;

  // A segment can straddle the window edge; clamp so the result stays inside the
  // window the caller asked for.
  if (best.sM < minSM || best.sM > maxSM) {
    const clamped = Math.min(maxSM, Math.max(minSM, best.sM));
    return { ...best, sM: clamped };
  }
  return best;
}

/**
 * Inverse of projection: the coordinate at a given distance along the line.
 * This is what keeps the map marker exactly on the road rather than on a straight
 * line between two distant fixes.
 */
export function interpolateAt(line: PreparedPolyline, sM: number): LonLat {
  const clamped = Math.min(line.lengthM, Math.max(0, sM));
  const i = segmentIndexForDistance(line, clamped);
  const segStart = line.cumulativeM[i]!;
  const segEnd = line.cumulativeM[i + 1]!;
  const segLenM = segEnd - segStart;
  const a = line.points[i]!;
  const b = line.points[i + 1]!;
  if (segLenM === 0) return [a[0], a[1]];
  const t = (clamped - segStart) / segLenM;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Index of the segment containing `sM`. Binary search over cumulative distance. */
export function segmentIndexForDistance(line: PreparedPolyline, sM: number): number {
  const last = line.points.length - 2;
  if (sM <= 0) return 0;
  if (sM >= line.lengthM) return last;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (line.cumulativeM[mid]! <= sM) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The polyline's own vertices between two distances, used to draw the travelled
 * and remaining parts of the route separately.
 */
export function sliceBetween(
  line: PreparedPolyline,
  fromSM: number,
  toSM: number,
): LonLat[] {
  const a = Math.min(line.lengthM, Math.max(0, Math.min(fromSM, toSM)));
  const b = Math.min(line.lengthM, Math.max(0, Math.max(fromSM, toSM)));
  const out: LonLat[] = [interpolateAt(line, a)];
  for (let i = 0; i < line.points.length; i += 1) {
    const c = line.cumulativeM[i]!;
    if (c > a && c < b) out.push(line.points[i]!);
  }
  out.push(interpolateAt(line, b));
  return out;
}
