import type { JourneyMode, StopEta } from '@buskothay/shared';
import { livenessOf } from './liveness.js';

/**
 * Where the bus is, said one stop at a time.
 *
 * The server publishes four statuses — passed, near, upcoming, unknown — and
 * says nothing about which upcoming stop is the *next* one, because that is a
 * presentational distinction rather than an evidential one. This module makes
 * exactly that distinction and no other: it never promotes a stop to passed, and
 * it never invents a position. Colour is assigned here, once, so the timeline,
 * the map legend and the progress bar cannot disagree.
 *
 *   passed      → green   the bus has been confirmed past this stop
 *   at          → amber   the bus is standing at, or level with, this stop
 *   approaching → red     the next stop the bus will reach
 *   ahead       → red     further along, outlined rather than filled
 *   unknown     → grey    no live bus, so no claim at all
 */
export type StopProgress = 'passed' | 'at' | 'approaching' | 'ahead' | 'unknown';

export interface ProgressRow {
  readonly stop: StopEta;
  readonly index: number;
  readonly progress: StopProgress;
}

export interface RouteProgress {
  readonly rows: readonly ProgressRow[];
  /** Index of the stop the bus is at or has most recently passed. Null if unknown. */
  readonly busIndex: number | null;
  /** Index of the next stop the bus will reach. Null when none is known. */
  readonly nextIndex: number | null;
  readonly passedCount: number;
}

export function routeProgress(
  stops: readonly StopEta[],
  mode: JourneyMode | null,
): RouteProgress {
  if (livenessOf(mode) === 'none') {
    return {
      rows: stops.map((stop, index) => ({ stop, index, progress: 'unknown' as const })),
      busIndex: null,
      nextIndex: null,
      passedCount: 0,
    };
  }

  // "near" wins over "passed": a bus standing at a stop has not passed it, and
  // saying otherwise would move it forward on the strength of nothing.
  const atIndex = stops.findIndex((stop) => stop.status === 'near');
  let lastPassed: number | null = null;
  stops.forEach((stop, index) => {
    if (stop.status === 'passed') lastPassed = index;
  });
  const busIndex = atIndex >= 0 ? atIndex : lastPassed;

  const nextIndex = stops.findIndex(
    (stop, index) => stop.status !== 'passed' && index !== atIndex,
  );

  const rows = stops.map((stop, index): ProgressRow => {
    if (index === atIndex) return { stop, index, progress: 'at' };
    if (stop.status === 'passed') return { stop, index, progress: 'passed' };
    if (stop.status === 'unknown') return { stop, index, progress: 'unknown' };
    if (index === nextIndex) return { stop, index, progress: 'approaching' };
    return { stop, index, progress: 'ahead' };
  });

  return {
    rows,
    busIndex,
    nextIndex: nextIndex < 0 ? null : nextIndex,
    passedCount: rows.filter((row) => row.progress === 'passed').length,
  };
}

/**
 * How far along the route the bus is, 0 to 1.
 *
 * Measured in stops rather than metres so that the bar agrees with the timeline
 * beside it: a bar three-quarters full next to five of eight stops greyed out
 * reads as a contradiction even when both numbers are right.
 */
export function progressFraction(progress: RouteProgress, total: number): number {
  if (progress.busIndex === null || total <= 1) return 0;
  return Math.min(1, Math.max(0, (progress.busIndex + 0.5) / total));
}
