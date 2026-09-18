/**
 * Metric conversions for a small geographic area.
 *
 * Everything in BusKothay that measures distance measures it in metres. A degree
 * of latitude and a degree of longitude are not the same length, and the
 * longitude one shrinks towards the poles, so we never do Euclidean arithmetic
 * on raw degrees. The two helpers below give the local scale factors; the rest of
 * this package converts to metres first and only then does geometry.
 */

const DEG_TO_RAD = Math.PI / 180;

/** Mean Earth radius (metres), the value used by the haversine formula here. */
export const EARTH_RADIUS_M = 6371008.8;

/**
 * Metres per degree of latitude at a given latitude.
 * Series expansion of the WGS84 meridian arc; accurate to well under a metre
 * across the Kolkata–Howrah corridor.
 */
export function metresPerDegreeLatitude(latDeg: number): number {
  const phi = latDeg * DEG_TO_RAD;
  return (
    111132.92 -
    559.82 * Math.cos(2 * phi) +
    1.175 * Math.cos(4 * phi) -
    0.0023 * Math.cos(6 * phi)
  );
}

/** Metres per degree of longitude at a given latitude. */
export function metresPerDegreeLongitude(latDeg: number): number {
  const phi = latDeg * DEG_TO_RAD;
  return (
    111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi)
  );
}

/**
 * Great-circle distance in metres.
 * Used for polyline segment lengths, where the endpoints can be a few hundred
 * metres apart and the planar approximation would start to drift.
 */
export function haversineMetres(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): number {
  const dLat = (latB - latA) * DEG_TO_RAD;
  const dLon = (lonB - lonA) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * DEG_TO_RAD) * Math.cos(latB * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing in degrees [0, 360) from A to B. Advisory; used for map icons only. */
export function bearingDegrees(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): number {
  const phi1 = latA * DEG_TO_RAD;
  const phi2 = latB * DEG_TO_RAD;
  const dLon = (lonB - lonA) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}
