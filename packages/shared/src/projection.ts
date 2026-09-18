import {
  AUTO_END_S,
  ESTIMATE_HORIZON_S,
  LIVE_TIMEOUT_S,
  MAX_PROJECTED_M,
} from './constants.js';
import type { JourneyMode, ProjectionAnchor } from './schemas/journey.js';

/**
 * The one bounded projection.
 *
 * The API computes the passenger's position with this function at read time, and
 * the browser advances the marker between polls with the same function and the
 * same anchor. There is deliberately no second implementation: a frontend loop
 * that does not know the server's caps is how a marker ends up drifting down the
 * route forever after the network drops.
 */

export interface BoundedProjection {
  /** Distance along the route to display, metres. */
  readonly sM: number;
  /** True once the estimate has stopped advancing (cap reached or horizon passed). */
  readonly isFrozen: boolean;
  /** Seconds since the anchor was confirmed, clamped at zero. */
  readonly ageSeconds: number;
}

/** Milliseconds at which a constant-speed projection would reach its cap. */
export function capReachedAtMs(anchor: ProjectionAnchor): number {
  const capSM = effectiveCapSM(anchor);
  const remainingM = capSM - anchor.sM;
  if (remainingM <= 0) return anchor.confirmedAtMs;
  if (anchor.speedMps <= 0) return Number.POSITIVE_INFINITY;
  return anchor.confirmedAtMs + (remainingM / anchor.speedMps) * 1000;
}

/**
 * The cap, clamped to at least the anchor itself.
 *
 * A stop slightly behind the anchor that has not met its pass-confirmation
 * margin would otherwise produce a cap below the anchor and pull the marker
 * backwards, which looks to a passenger like the bus reversing.
 */
export function effectiveCapSM(anchor: ProjectionAnchor): number {
  return Math.max(anchor.capSM, anchor.sM);
}

/**
 * When the estimate freezes: the later of the estimated threshold and the
 * earlier of the 90-second horizon and cap arrival. Server and client must agree
 * on this to the millisecond, so both read it from the anchor the server sent.
 */
export function computeStaleAtMs(
  confirmedAtMs: number,
  estimatedAtMs: number,
  capArrivalMs: number,
): number {
  const horizonMs = confirmedAtMs + ESTIMATE_HORIZON_S * 1000;
  return Math.max(estimatedAtMs, Math.min(horizonMs, capArrivalMs));
}

/** The moment the position stops being described as live. */
export function computeEstimatedAtMs(confirmedAtMs: number): number {
  return confirmedAtMs + LIVE_TIMEOUT_S * 1000;
}

/** The moment the journey ends on its own for want of evidence. */
export function computeAutoEndAtMs(confirmedAtMs: number): number {
  return confirmedAtMs + AUTO_END_S * 1000;
}

/** The distance cap for an anchor, before the next-stop cap is applied. */
export function distanceCapSM(anchorSM: number, routeLengthM: number): number {
  return Math.min(routeLengthM, anchorSM + MAX_PROJECTED_M);
}

/**
 * Advance the anchor to `atMs`, bounded by the cap and the stale deadline.
 *
 * `atMs` before the anchor is clamped, so a client whose wall clock runs slow
 * cannot pull the bus backwards.
 */
export function projectBounded(anchor: ProjectionAnchor, atMs: number): BoundedProjection {
  const capSM = effectiveCapSM(anchor);
  const freezeAtMs = Math.max(anchor.staleAtMs, anchor.confirmedAtMs);
  const effectiveMs = Math.min(Math.max(atMs, anchor.confirmedAtMs), freezeAtMs);
  const dtS = (effectiveMs - anchor.confirmedAtMs) / 1000;

  const advancedSM = anchor.sM + Math.max(0, anchor.speedMps) * dtS;
  const sM = Math.min(advancedSM, capSM);

  const ageSeconds = Math.max(0, (atMs - anchor.confirmedAtMs) / 1000);
  const isFrozen = atMs >= freezeAtMs || advancedSM >= capSM;

  return { sM, isFrozen, ageSeconds };
}

/**
 * The mode implied purely by elapsed time since the anchor.
 *
 * `baseMode` is what the journey was at its last accepted fix — LIVE or DWELLING.
 * Terminal modes are returned unchanged. Deriving this from timestamps rather
 * than from a background ticker is what lets repeated GETs stay idempotent: the
 * same request at the same moment always produces the same mode and the same
 * state version.
 */
export function modeAtTime(
  baseMode: JourneyMode,
  anchor: ProjectionAnchor | null,
  atMs: number,
): JourneyMode {
  if (baseMode === 'ENDED' || baseMode === 'PENDING') return baseMode;
  if (anchor === null) return baseMode;
  if (atMs >= anchor.endedAtMs) return 'ENDED';
  if (atMs >= anchor.staleAtMs) return 'STALE';
  if (atMs >= anchor.estimatedAtMs) return 'ESTIMATED';
  return baseMode;
}

/** True while the mode still supports a tracking-based arrival estimate. */
export function modeSupportsTrackingEta(mode: JourneyMode): boolean {
  return mode === 'LIVE' || mode === 'DWELLING' || mode === 'ESTIMATED';
}
