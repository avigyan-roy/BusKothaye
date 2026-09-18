/** `[longitude, latitude]`, GeoJSON order throughout the project. */
export type LonLat = readonly [number, number];

/**
 * A polyline prepared for repeated projection.
 *
 * `cumulativeM[i]` is the distance along the line from its start to `points[i]`,
 * so `cumulativeM[0] === 0` and the last entry equals `lengthM`. Building this
 * once per route version is what makes projection cheap enough to run on every
 * incoming location report.
 */
export interface PreparedPolyline {
  readonly points: readonly LonLat[];
  readonly cumulativeM: readonly number[];
  readonly lengthM: number;
}

/** Result of projecting a coordinate onto a polyline. */
export interface Projection {
  /** Distance along the line, in metres from its start. */
  readonly sM: number;
  /** Perpendicular distance from the line, in metres. Never negative. */
  readonly offsetM: number;
  /** Index of the segment that produced the match, for diagnostics. */
  readonly segmentIndex: number;
}

/** An inclusive window of along-route distance to search, in metres. */
export interface SearchWindowM {
  readonly minSM: number;
  readonly maxSM: number;
}
