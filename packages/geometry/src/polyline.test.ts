import { describe, expect, it } from 'vitest';
import {
  interpolateAt,
  pointToSegment,
  preparePolyline,
  projectToPolyline,
  segmentIndexForDistance,
  sliceBetween,
} from './polyline.js';
import { haversineMetres, metresPerDegreeLatitude, metresPerDegreeLongitude } from './units.js';
import type { LonLat } from './types.js';

/** A straight 1 km east–west line near Kolkata's latitude. */
const LAT = 22.5;
const METRES_PER_DEG_LON = metresPerDegreeLongitude(LAT);
const KM_IN_DEGREES = 1000 / METRES_PER_DEG_LON;

const straight: LonLat[] = [
  [88.3, LAT],
  [88.3 + KM_IN_DEGREES, LAT],
];

/**
 * The line's real length.
 *
 * Segment lengths come from the haversine formula on a sphere, while
 * point-to-segment work uses a local ellipsoidal metre scale. The two models
 * differ by about 0.2% — under two metres per kilometre, far below GPS noise —
 * so the tests measure against the length the library actually computes rather
 * than against a round number from the other model.
 */
const LINE_M = preparePolyline(straight).lengthM;

describe('metric conversions', () => {
  it('does not treat a degree of longitude as a degree of latitude', () => {
    // The whole reason the package exists: at this latitude a degree of longitude
    // is about 8% shorter than a degree of latitude, and Euclidean arithmetic on
    // raw degrees silently gets that wrong.
    expect(metresPerDegreeLongitude(LAT)).toBeLessThan(metresPerDegreeLatitude(LAT));
    expect(metresPerDegreeLatitude(LAT)).toBeGreaterThan(110000);
  });

  it('measures a known distance to within the difference between the two models', () => {
    const measured = haversineMetres(88.3, LAT, 88.3 + KM_IN_DEGREES, LAT);
    expect(Math.abs(measured - 1000) / 1000).toBeLessThan(0.005);
  });
});

describe('pointToSegment', () => {
  it('finds the perpendicular distance in metres', () => {
    const offsetDegrees = 50 / metresPerDegreeLatitude(LAT);
    const result = pointToSegment(
      [88.3 + KM_IN_DEGREES / 2, LAT + offsetDegrees],
      straight[0]!,
      straight[1]!,
    );
    expect(result.t).toBeCloseTo(0.5, 2);
    expect(result.distanceM).toBeCloseTo(50, 0);
  });

  it('clamps beyond the ends rather than extending the line', () => {
    const before = pointToSegment([88.3 - KM_IN_DEGREES, LAT], straight[0]!, straight[1]!);
    expect(before.t).toBe(0);
    expect(before.distanceM).toBeCloseTo(1000, 0);
  });

  it('handles a zero-length segment without dividing by zero', () => {
    const result = pointToSegment([88.3, LAT + 0.001], [88.3, LAT], [88.3, LAT]);
    expect(Number.isFinite(result.distanceM)).toBe(true);
    expect(result.t).toBe(0);
  });
});

describe('preparePolyline', () => {
  it('builds cumulative distances that end at the line length', () => {
    const line = preparePolyline(straight);
    expect(line.cumulativeM[0]).toBe(0);
    expect(line.cumulativeM.at(-1)).toBe(line.lengthM);
    expect(line.lengthM).toBeCloseTo(LINE_M, 6);
  });

  it('rejects input that would produce nonsense later', () => {
    expect(() => preparePolyline([[0, 0]] as LonLat[])).toThrow();
    expect(() => preparePolyline([[Number.NaN, 0], [1, 1]])).toThrow();
    expect(() => preparePolyline([[0, 200], [1, 1]])).toThrow();
  });

  it('tolerates a repeated coordinate', () => {
    const line = preparePolyline([straight[0]!, straight[0]!, straight[1]!]);
    expect(line.lengthM).toBeCloseTo(LINE_M, 6);
  });
});

describe('projectToPolyline', () => {
  const line = preparePolyline(straight);

  it('round-trips a distance through interpolation and back', () => {
    for (const sM of [0, 1, 250, 500, LINE_M - 1, LINE_M]) {
      const [lon, lat] = interpolateAt(line, sM);
      const projected = projectToPolyline(line, lon, lat);
      expect(projected).not.toBeNull();
      expect(projected!.sM).toBeCloseTo(sM, 0);
      expect(projected!.offsetM).toBeLessThan(0.5);
    }
  });

  it('clamps interpolation outside the line', () => {
    expect(interpolateAt(line, -100)).toEqual(interpolateAt(line, 0));
    expect(interpolateAt(line, 99999)).toEqual(interpolateAt(line, line.lengthM));
  });

  it('returns null when the window excludes every segment', () => {
    // "No plausible match" must not be reported as distance zero, which would
    // teleport a vehicle to the start of the route.
    expect(projectToPolyline(line, 88.3, LAT, { minSM: 5000, maxSM: 6000 })).toBeNull();
  });

  it('uses the window to disambiguate a route that runs back over itself', () => {
    // Out and back along the same road: one coordinate, two valid distances.
    const outAndBack = preparePolyline([
      [88.3, LAT],
      [88.3 + KM_IN_DEGREES, LAT],
      [88.3, LAT],
    ]);
    const midpoint = interpolateAt(outAndBack, 500);

    const outbound = projectToPolyline(outAndBack, midpoint[0], midpoint[1], {
      minSM: 300,
      maxSM: 700,
    });
    const returning = projectToPolyline(outAndBack, midpoint[0], midpoint[1], {
      minSM: 1300,
      maxSM: 1700,
    });

    // Without the window, one of these would teleport to the other.
    expect(outbound!.sM).toBeCloseTo(500, 0);
    expect(returning!.sM).toBeCloseTo(outAndBack.lengthM - 500, 0);
  });
});

describe('segmentIndexForDistance', () => {
  it('finds the containing segment at the boundaries', () => {
    const line = preparePolyline([
      [88.3, LAT],
      [88.3 + KM_IN_DEGREES, LAT],
      [88.3 + 2 * KM_IN_DEGREES, LAT],
    ]);
    const firstSegmentEnd = line.cumulativeM[1]!;
    expect(segmentIndexForDistance(line, 0)).toBe(0);
    expect(segmentIndexForDistance(line, firstSegmentEnd - 1)).toBe(0);
    expect(segmentIndexForDistance(line, firstSegmentEnd)).toBe(1);
    expect(segmentIndexForDistance(line, firstSegmentEnd + 1)).toBe(1);
    expect(segmentIndexForDistance(line, 999999)).toBe(1);
  });
});

describe('sliceBetween', () => {
  it('returns a slice bounded by the requested distances', () => {
    const line = preparePolyline(straight);
    const slice = sliceBetween(line, 200, 800);
    expect(slice.length).toBeGreaterThanOrEqual(2);
    expect(projectToPolyline(line, slice[0]![0], slice[0]![1])!.sM).toBeCloseTo(200, 0);
    expect(
      projectToPolyline(line, slice.at(-1)![0], slice.at(-1)![1])!.sM,
    ).toBeCloseTo(800, 0);
  });
});
