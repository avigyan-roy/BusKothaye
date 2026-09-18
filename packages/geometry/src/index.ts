export type { LonLat, PreparedPolyline, Projection, SearchWindowM } from './types.js';
export {
  EARTH_RADIUS_M,
  bearingDegrees,
  haversineMetres,
  metresPerDegreeLatitude,
  metresPerDegreeLongitude,
} from './units.js';
export {
  interpolateAt,
  pointToSegment,
  preparePolyline,
  projectToPolyline,
  segmentIndexForDistance,
  sliceBetween,
} from './polyline.js';
