import { describe, expect, it } from 'vitest';
import type { JourneyMode, StopEta } from '@buskothay/shared';
import { progressFraction, routeProgress } from './stop-progress.js';
import { arrivalAt, formatClock } from '../../lib/format.js';

/**
 * The two things on the passenger screen that would actively mislead someone if
 * they were wrong: which stop the bus is at, and what time it gets to theirs.
 */

function stop(id: string, status: StopEta['status'], etaSeconds: number | null = null): StopEta {
  return {
    stopId: id,
    name: id,
    distanceM: null,
    status,
    etaSeconds,
    etaRangeSeconds: null,
    scheduledTs: null,
    basis: etaSeconds === null ? 'unavailable' : 'live',
  };
}

describe('route progress', () => {
  it('colours passed, current and approaching stops distinctly', () => {
    const progress = routeProgress(
      [
        stop('a', 'passed'),
        stop('b', 'passed'),
        stop('c', 'near'),
        stop('d', 'upcoming', 300),
        stop('e', 'upcoming', 900),
      ],
      'LIVE',
    );
    expect(progress.rows.map((row) => row.progress)).toEqual([
      'passed',
      'passed',
      'at',
      'approaching',
      'ahead',
    ]);
    expect(progress.busIndex).toBe(2);
    expect(progress.passedCount).toBe(2);
  });

  it('treats a bus standing at a stop as at it, never past it', () => {
    // "near" appears before a later "passed" would; the bus has not left yet,
    // and promoting it would move the bus forward on no evidence at all.
    const progress = routeProgress([stop('a', 'passed'), stop('b', 'near'), stop('c', 'upcoming', 60)], 'DWELLING');
    expect(progress.rows[1]!.progress).toBe('at');
    expect(progress.busIndex).toBe(1);
  });

  it('claims nothing at all when no bus is being tracked', () => {
    for (const mode of ['STALE', 'PENDING', 'ENDED', null] as (JourneyMode | null)[]) {
      const progress = routeProgress([stop('a', 'passed'), stop('b', 'upcoming', 60)], mode);
      expect(progress.rows.every((row) => row.progress === 'unknown')).toBe(true);
      expect(progress.busIndex).toBeNull();
      expect(progressFraction(progress, 2)).toBe(0);
    }
  });

  it('advances the progress bar as the bus passes stops', () => {
    const early = routeProgress([stop('a', 'near'), stop('b', 'upcoming', 60), stop('c', 'upcoming', 120)], 'LIVE');
    const late = routeProgress([stop('a', 'passed'), stop('b', 'passed'), stop('c', 'near')], 'LIVE');
    expect(progressFraction(early, 3)).toBeLessThan(progressFraction(late, 3));
    expect(progressFraction(late, 3)).toBeLessThanOrEqual(1);
  });
});

describe('arrival clock', () => {
  it('is a single 24-hour time, not a range', () => {
    // 18:35 local, plus eighteen minutes.
    const base = new Date(2026, 8, 20, 18, 35, 0).getTime();
    const arrival = arrivalAt(18 * 60, base);
    expect(arrival?.clock).toBe('18:53');
    expect(arrival?.minutes).toBe(18);
    expect(arrival?.clock).toMatch(/^\d{2}:\d{2}$/);
  });

  it('pads and rolls over midnight without producing a 12-hour time', () => {
    const base = new Date(2026, 8, 20, 23, 55, 0).getTime();
    expect(arrivalAt(10 * 60, base)?.clock).toBe('00:05');
    expect(formatClock(new Date(2026, 8, 20, 9, 5, 0).getTime())).toBe('09:05');
  });

  it('has no opinion when the server has none', () => {
    expect(arrivalAt(null)).toBeNull();
    expect(arrivalAt(undefined)).toBeNull();
    expect(arrivalAt(Number.NaN)).toBeNull();
    expect(arrivalAt(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('never rounds an imminent arrival down to zero minutes', () => {
    expect(arrivalAt(5)?.minutes).toBe(1);
  });
});
