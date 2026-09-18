import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_HORIZON_S,
  LIVE_TIMEOUT_S,
  MAX_PROJECTED_M,
} from './constants.js';
import {
  capReachedAtMs,
  computeAutoEndAtMs,
  computeEstimatedAtMs,
  computeStaleAtMs,
  distanceCapSM,
  effectiveCapSM,
  modeAtTime,
  projectBounded,
} from './projection.js';
import { createFixedClock, reportAgeMs } from './time.js';
import type { ProjectionAnchor } from './schemas/journey.js';

const T0 = 1_700_000_000_000;

function anchorAt(overrides: Partial<ProjectionAnchor> = {}): ProjectionAnchor {
  const confirmedAtMs = overrides.confirmedAtMs ?? T0;
  const estimatedAtMs = computeEstimatedAtMs(confirmedAtMs);
  const base: ProjectionAnchor = {
    confirmedAtMs,
    sM: 1000,
    speedMps: 8,
    capSM: 5000,
    estimatedAtMs,
    staleAtMs: estimatedAtMs,
    endedAtMs: computeAutoEndAtMs(confirmedAtMs),
    sigmaM: 20,
    covariance: [400, 0, 0, 25],
    ...overrides,
  };
  return { ...base, staleAtMs: overrides.staleAtMs ?? computeStaleAtMs(confirmedAtMs, base.estimatedAtMs, capReachedAtMs(base)) };
}

describe('bounded projection', () => {
  it('advances at the anchor speed while inside the horizon', () => {
    const anchor = anchorAt();
    const result = projectBounded(anchor, T0 + 5000);
    expect(result.sM).toBeCloseTo(1040, 0);
    expect(result.isFrozen).toBe(false);
    expect(result.ageSeconds).toBeCloseTo(5, 3);
  });

  it('freezes at the 90 second horizon and never advances again', () => {
    const anchor = anchorAt({ capSM: 1_000_000 });
    const atHorizon = projectBounded(anchor, T0 + ESTIMATE_HORIZON_S * 1000);
    const muchLater = projectBounded(anchor, T0 + 10 * 60 * 1000);
    expect(atHorizon.sM).toBeCloseTo(1000 + 8 * ESTIMATE_HORIZON_S, 0);
    // The failure this rules out is the marker walking down the route forever
    // after the network drops.
    expect(muchLater.sM).toBeCloseTo(atHorizon.sM, 6);
    expect(muchLater.isFrozen).toBe(true);
  });

  it('stops at the cap before the horizon when the cap is nearer', () => {
    const anchor = anchorAt({ capSM: 1200 });
    const result = projectBounded(anchor, T0 + 60_000);
    expect(result.sM).toBe(1200);
    expect(result.isFrozen).toBe(true);
  });

  it('never moves backwards when the cap is behind the anchor', () => {
    // A stop slightly behind the bus that has not met its pass-confirmation
    // margin must not drag the marker backwards.
    const anchor = anchorAt({ capSM: 900 });
    expect(effectiveCapSM(anchor)).toBe(1000);
    expect(projectBounded(anchor, T0 + 30_000).sM).toBe(1000);
  });

  it('clamps a client clock that runs behind the server', () => {
    const anchor = anchorAt();
    expect(projectBounded(anchor, T0 - 60_000).sM).toBe(1000);
  });

  it('does not move a stationary bus', () => {
    const anchor = anchorAt({ speedMps: 0 });
    expect(capReachedAtMs(anchor)).toBe(Number.POSITIVE_INFINITY);
    expect(projectBounded(anchor, T0 + 60_000).sM).toBe(1000);
  });
});

describe('stale deadline', () => {
  it('is never earlier than the estimated threshold', () => {
    const confirmedAtMs = T0;
    const estimatedAtMs = computeEstimatedAtMs(confirmedAtMs);
    // Cap already reached: the deadline still cannot precede ESTIMATED.
    const staleAtMs = computeStaleAtMs(confirmedAtMs, estimatedAtMs, confirmedAtMs);
    expect(staleAtMs).toBe(estimatedAtMs);
    expect(staleAtMs).toBe(confirmedAtMs + LIVE_TIMEOUT_S * 1000);
  });

  it('takes the earlier of the horizon and cap arrival', () => {
    const confirmedAtMs = T0;
    const estimatedAtMs = computeEstimatedAtMs(confirmedAtMs);
    const early = computeStaleAtMs(confirmedAtMs, estimatedAtMs, confirmedAtMs + 30_000);
    const late = computeStaleAtMs(confirmedAtMs, estimatedAtMs, confirmedAtMs + 300_000);
    expect(early).toBe(confirmedAtMs + 30_000);
    expect(late).toBe(confirmedAtMs + ESTIMATE_HORIZON_S * 1000);
  });
});

describe('distance cap', () => {
  it('is the smaller of the travel cap and the route end', () => {
    expect(distanceCapSM(1000, 20000)).toBe(1000 + MAX_PROJECTED_M);
    expect(distanceCapSM(19900, 20000)).toBe(20000);
  });
});

describe('mode derived from elapsed time', () => {
  const anchor = anchorAt({ capSM: 1_000_000 });

  it('walks LIVE to ESTIMATED to STALE to ENDED on the documented boundaries', () => {
    expect(modeAtTime('LIVE', anchor, T0 + 5_000)).toBe('LIVE');
    expect(modeAtTime('LIVE', anchor, T0 + LIVE_TIMEOUT_S * 1000)).toBe('ESTIMATED');
    expect(modeAtTime('LIVE', anchor, T0 + ESTIMATE_HORIZON_S * 1000)).toBe('STALE');
    expect(modeAtTime('LIVE', anchor, T0 + 300_000)).toBe('ENDED');
  });

  it('degrades a dwelling journey the same way', () => {
    expect(modeAtTime('DWELLING', anchor, T0 + 5_000)).toBe('DWELLING');
    expect(modeAtTime('DWELLING', anchor, T0 + 20_000)).toBe('ESTIMATED');
  });

  it('leaves terminal and pending modes alone', () => {
    expect(modeAtTime('ENDED', anchor, T0 + 1)).toBe('ENDED');
    expect(modeAtTime('PENDING', anchor, T0 + 500_000)).toBe('PENDING');
  });

  it('is a pure function of time, so repeated reads agree', () => {
    const first = modeAtTime('LIVE', anchor, T0 + 42_000);
    const second = modeAtTime('LIVE', anchor, T0 + 42_000);
    expect(first).toBe(second);
  });
});

describe('clock handling', () => {
  it('keeps monotonic time still when the wall clock jumps', () => {
    const clock = createFixedClock(T0);
    clock.advance(5_000);
    const monotonicBefore = clock.monotonicMs();
    // A phone whose clock jumps two hours must not change any duration.
    clock.set(T0 + 2 * 60 * 60 * 1000);
    expect(clock.monotonicMs()).toBe(monotonicBefore);
  });

  it('bounds a client-reported sample age', () => {
    const received = T0;
    const now = T0 + 1000;
    // An honest backlog is aged correctly.
    expect(reportAgeMs(received, now, 4000, 120_000)).toBe(5000);
    // A wild claim is capped rather than believed.
    expect(reportAgeMs(received, now, 9_999_999, 120_000)).toBe(121_000);
    // Negative durations never appear.
    expect(reportAgeMs(now, received, -50, 120_000)).toBe(0);
  });
});
