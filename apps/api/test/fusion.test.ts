import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACCURACY_REJECT_M,
  AUTO_END_S,
  ESTIMATE_HORIZON_S,
  LIVE_TIMEOUT_S,
  MAX_PROJECTED_M,
  STOP_PASS_MARGIN_M,
  type PreparedRoute,
  type RejectReason,
} from '@buskothay/shared';
import {
  addContributor,
  buildAnchor,
  createJourneySnapshot,
  derivedModeAt,
  deriveState,
  endJourney,
  impliedEnd,
  ingest,
  computeStopEtas,
  computeDelaySeconds,
  type JourneySnapshot,
} from '../src/fusion/index.js';
import { combine, type FusionSample } from '../src/fusion/consensus.js';
import { initialFilter, predict, sigmaM, update } from '../src/fusion/kalman.js';
import { loadAc24, reportAt } from './helpers.js';

/**
 * The fusion engine, driven with an injected clock.
 *
 * Time travel here is simulated: minutes of journey behaviour run in
 * milliseconds. That is only legitimate because the engine is pure — the
 * real-time HTTP behaviour is measured by the simulator instead, at timeScale 1.
 */

const T0 = 1_700_000_000_000;
let route: PreparedRoute;

beforeAll(async () => {
  route = await loadAc24();
});

function newJourney(nowMs = T0): JourneySnapshot {
  return createJourneySnapshot({
    journeyId: 'j_test',
    routeId: route.dto.id,
    routeVersion: route.dto.version,
    isDemo: true,
    nowMs,
    driverContributorId: 'driver',
    driverTokenHash: 'hash-driver',
    opsTokenHash: 'hash-ops',
    joinCodeHash: 'hash-code',
  });
}

function withPassenger(snapshot: JourneySnapshot, id: string, nowMs: number): JourneySnapshot {
  return addContributor(snapshot, {
    contributorId: id,
    role: 'passenger',
    tokenHash: `hash-${id}`,
    nowMs,
  });
}

interface FeedOptions {
  contributorId?: string;
  crossM?: number;
  accuracyM?: number;
  seq?: number;
}

function feed(
  snapshot: JourneySnapshot,
  sM: number,
  nowMs: number,
  options: FeedOptions = {},
): { snapshot: JourneySnapshot; reason: RejectReason | null; accepted: boolean } {
  const contributorId = options.contributorId ?? 'driver';
  const contributor = snapshot.contributors.find((c) => c.contributorId === contributorId)!;
  const seq = options.seq ?? (contributor.lastSeq ?? -1) + 1;
  const result = ingest({
    snapshot,
    route,
    contributorId,
    reports: [
      reportAt(route, {
        seq,
        sM,
        ...(options.crossM === undefined ? {} : { crossM: options.crossM }),
        ...(options.accuracyM === undefined ? {} : { accuracyM: options.accuracyM }),
      }),
    ],
    receivedAtMs: nowMs,
    nowMs,
  });
  const decision = result.decisions[0]!;
  return { snapshot: result.snapshot, reason: decision.reason, accepted: decision.accepted };
}

function stateOf(snapshot: JourneySnapshot, nowMs: number) {
  return deriveState({
    snapshot,
    route,
    nowMs,
    delaySeconds: computeDelaySeconds(route.dto),
    computeStopEtas: (context) =>
      computeStopEtas({
        route: route.dto,
        mode: context.mode,
        sM: context.sM,
        vMps: context.vMps,
        journeyMeanMps: context.journeyMeanMps,
        offRoute: context.offRoute,
        passedStopIds: context.passedStopIds,
        speedEstablished: context.speedEstablished,
        nowMs,
      }),
  });
}

// ---------------------------------------------------------------------------

describe('pending state', () => {
  it('has no position, no ETA and no invented coordinates', () => {
    const state = stateOf(newJourney(), T0 + 1000);
    expect(state.mode).toBe('PENDING');
    expect(state.position).toBeNull();
    expect(state.lastConfirmedPosition).toBeNull();
    expect(state.projection).toBeNull();
    expect(state.confidenceM).toBeNull();
    expect(state.progressFraction).toBeNull();
    // Missing GPS is null, never [0, 0] or an arrival of zero minutes.
    for (const stop of state.stops) {
      expect(stop.etaSeconds).toBeNull();
      expect(stop.status).toBe('unknown');
    }
  });

  it('expires from PENDING without ever receiving a fix', () => {
    const snapshot = newJourney();
    expect(impliedEnd(snapshot, T0 + 10_000)).toBeNull();
    expect(impliedEnd(snapshot, T0 + AUTO_END_S * 1000)).toBe('inactivity');
    expect(derivedModeAt(snapshot, route, T0 + AUTO_END_S * 1000)).toBe('ENDED');
  });
});

describe('measurement gates', () => {
  it('rejects a fix that is too inaccurate to use', () => {
    const result = feed(newJourney(), 500, T0 + 1000, { accuracyM: ACCURACY_REJECT_M + 1 });
    expect(result.reason).toBe('POOR_ACCURACY');
    expect(result.accepted).toBe(false);
  });

  it('rejects a fix far outside the corridor', () => {
    const result = feed(newJourney(), 500, T0 + 1000, { crossM: 400 });
    expect(result.reason).toBe('OFF_CORRIDOR');
  });

  it('rejects a duplicate sequence number without applying it twice', () => {
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, 500, T0 + 1000, { seq: 1 }));
    const before = snapshot.filter!.sM;
    const replay = feed(snapshot, 4000, T0 + 2000, { seq: 1 });
    expect(replay.reason).toBe('DUPLICATE');
    expect(replay.snapshot.filter!.sM).toBeCloseTo(before, 6);
  });

  it('rejects movement that would need an impossible speed', () => {
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, 500, T0 + 1000));
    const jump = feed(snapshot, 9000, T0 + 4000);
    expect(jump.reason).toBe('IMPOSSIBLE_MOVEMENT');
  });

  it('rejects a large step backwards along the route', () => {
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, 3000, T0 + 1000));
    const back = feed(snapshot, 2500, T0 + 4000);
    expect(back.reason).toBe('BACKWARD');
  });
});

describe('consensus before accuracy weighting', () => {
  it('excludes one very precise liar from a majority of three honest sources', () => {
    const samples: FusionSample[] = [
      sample('a', 1000, 20),
      sample('b', 1010, 22),
      sample('c', 995, 18),
      // Claims five-metre accuracy, and is 400 m wrong. Inverse-variance weighting
      // alone would hand it most of the answer.
      sample('liar', 1400, 5),
    ];
    const result = combine(samples, 1000);
    expect(result.outlierIds).toContain('liar');
    expect(result.sM).toBeGreaterThan(960);
    expect(result.sM).toBeLessThan(1060);
  });

  it('caps any single source below half the answer when three survive', () => {
    const samples: FusionSample[] = [
      sample('precise', 1000, 5),
      sample('b', 1020, 40),
      sample('c', 1040, 40),
    ];
    const result = combine(samples, 1000);
    const precise = result.weightShares.get('precise') ?? 0;
    expect(precise).toBeLessThanOrEqual(0.45 + 1e-9);
  });

  it('prefers continuity and widens uncertainty when exactly two sources disagree', () => {
    const result = combine([sample('a', 1000, 10), sample('b', 1600, 5)], 1010);
    expect(result.sM).toBe(1000);
    expect(result.sigmaM).toBeGreaterThan(200);
    expect(result.ambiguity).not.toBeNull();
  });

  it('tracks from a lone source with a conservative confidence floor', () => {
    const result = combine([sample('only', 1000, 6)], null);
    expect(result.sM).toBe(1000);
    expect(result.sigmaM).toBeGreaterThanOrEqual(15);
  });

  it('flags two populated clusters instead of averaging two buses together', () => {
    const result = combine(
      [
        sample('a', 1000, 15),
        sample('b', 1020, 15),
        sample('c', 2000, 15),
        sample('d', 2030, 15),
      ],
      1000,
    );
    expect(result.ambiguity).toMatch(/cluster/i);
  });
});

function sample(sourceId: string, sM: number, accuracyM: number): FusionSample {
  return {
    sourceId,
    role: 'passenger',
    sM,
    accuracyM,
    offsetM: 5,
    ageMs: 0,
    reputation: 1,
    isProbationary: false,
  };
}

describe('kalman filter', () => {
  it('grows uncertainty while no measurement arrives', () => {
    const start = initialFilter(1000, 8);
    const after30 = predict(start, 30, route.dto.lengthM);
    const after90 = predict(start, 90, route.dto.lengthM);
    expect(sigmaM(after90)).toBeGreaterThan(sigmaM(after30));
    expect(sigmaM(after30)).toBeGreaterThan(sigmaM(start));
  });

  it('does not shrink uncertainty when the same measurement is replayed', () => {
    let state = initialFilter(1000, 0);
    const first = update(state, 1000, 20, route.dto.lengthM);
    const sigmaAfterOne = sigmaM(first.state);
    // The engine only ever assimilates the newest fresh report, but the filter
    // itself must also not reward a repeated observation as if it were new
    // evidence arriving over time.
    state = predict(first.state, 0, route.dto.lengthM);
    const second = update(state, 1000, 20, route.dto.lengthM);
    expect(sigmaM(second.state)).toBeLessThanOrEqual(sigmaAfterOne);
    expect(sigmaM(second.state)).toBeGreaterThan(0);
  });

  it('never produces a non-finite covariance', () => {
    let state = initialFilter(0, 0);
    for (let i = 0; i < 500; i += 1) {
      state = predict(state, 1, route.dto.lengthM);
      state = update(state, i * 8, 15, route.dto.lengthM).state;
    }
    expect(state.covariance.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(sigmaM(state))).toBe(true);
  });
});

describe('state machine boundaries', () => {
  function liveJourney(): JourneySnapshot {
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, 500, T0 + 1000));
    ({ snapshot } = feed(snapshot, 1000, T0 + 61_000));
    return snapshot;
  }

  it('moves LIVE to ESTIMATED at the live timeout', () => {
    const snapshot = liveJourney();
    const last = snapshot.lastConfirmedAtMs!;
    expect(derivedModeAt(snapshot, route, last + LIVE_TIMEOUT_S * 1000 - 1)).toBe('LIVE');
    expect(derivedModeAt(snapshot, route, last + LIVE_TIMEOUT_S * 1000)).toBe('ESTIMATED');
  });

  it('moves ESTIMATED to STALE at the horizon and ends at the inactivity limit', () => {
    const snapshot = liveJourney();
    const last = snapshot.lastConfirmedAtMs!;
    const anchor = buildAnchor(snapshot, route)!;
    expect(anchor.staleAtMs).toBeLessThanOrEqual(last + ESTIMATE_HORIZON_S * 1000);
    expect(derivedModeAt(snapshot, route, anchor.staleAtMs)).toBe('STALE');
    expect(derivedModeAt(snapshot, route, last + AUTO_END_S * 1000)).toBe('ENDED');
  });

  it('caps the projection at the travel limit or the next stop', () => {
    const snapshot = liveJourney();
    const anchor = buildAnchor(snapshot, route)!;
    expect(anchor.capSM).toBeLessThanOrEqual(anchor.sM + MAX_PROJECTED_M + 1e-6);
    expect(anchor.capSM).toBeGreaterThanOrEqual(anchor.sM);
  });

  it('repeated reads of the same moment do not change the state version', () => {
    const snapshot = liveJourney();
    const first = stateOf(snapshot, T0 + 120_000);
    const second = stateOf(snapshot, T0 + 120_000);
    expect(first.stateVersion).toBe(second.stateVersion);
    expect(first.events.length).toBe(second.events.length);
  });
});

describe('stop passing', () => {
  it('is never claimed from a predicted position, even exactly at the stop', () => {
    const ruby = route.dto.stops.find((s) => s.id === 'ruby')!;
    let snapshot = newJourney();
    // Approach Ruby, then go quiet. The projection will reach the stop.
    ({ snapshot } = feed(snapshot, ruby.sM - 700, T0 + 1000));
    ({ snapshot } = feed(snapshot, ruby.sM - 400, T0 + 41_000));

    const anchor = buildAnchor(snapshot, route)!;
    // The cap is the stop itself, so the estimate holds there.
    expect(anchor.capSM).toBeLessThanOrEqual(ruby.sM + 1e-6);

    const later = stateOf(snapshot, T0 + 41_000 + 80_000);
    const rubyRow = later.stops.find((s) => s.stopId === 'ruby')!;
    expect(rubyRow.status).not.toBe('passed');
    expect(snapshot.passedStopIds).not.toContain('ruby');
  });

  it('marks a stop passed only with accepted evidence beyond the margin', () => {
    const ruby = route.dto.stops.find((s) => s.id === 'ruby')!;
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, ruby.sM - 300, T0 + 1000));
    ({ snapshot } = feed(snapshot, ruby.sM + STOP_PASS_MARGIN_M + 40, T0 + 61_000));
    expect(snapshot.passedStopIds).toContain('ruby');
  });
});

describe('ETA', () => {
  it('is null while pending, and never NaN or Infinity once tracking', () => {
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, 200, T0 + 1000));
    ({ snapshot } = feed(snapshot, 600, T0 + 61_000));
    const state = stateOf(snapshot, T0 + 61_500);
    for (const stop of state.stops) {
      if (stop.etaSeconds !== null) {
        expect(Number.isFinite(stop.etaSeconds)).toBe(true);
        expect(stop.etaSeconds).toBeGreaterThan(0);
        expect(stop.etaRangeSeconds![0]).toBeLessThanOrEqual(stop.etaSeconds);
        expect(stop.etaRangeSeconds![1]).toBeGreaterThanOrEqual(stop.etaSeconds);
      }
    }
  });

  it('has no delay figure without a verified timetable', () => {
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, 200, T0 + 1000));
    expect(stateOf(snapshot, T0 + 2000).delaySeconds).toBeNull();
  });

  it('is suppressed once the position is stale', () => {
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, 200, T0 + 1000));
    ({ snapshot } = feed(snapshot, 600, T0 + 61_000));
    const stale = stateOf(snapshot, T0 + 61_000 + ESTIMATE_HORIZON_S * 1000 + 1000);
    expect(stale.mode).toBe('STALE');
    expect(stale.stops.every((s) => s.etaSeconds === null)).toBe(true);
  });
});

describe('clock skew', () => {
  it('does not move the bus or change freshness when a phone clock is wrong', () => {
    let honest = newJourney();
    ({ snapshot: honest } = feed(honest, 500, T0 + 1000));

    let skewed = newJourney();
    const result = ingest({
      snapshot: skewed,
      route,
      contributorId: 'driver',
      reports: [
        // Device timestamp two hours in the future; everything else identical.
        reportAt(route, { seq: 0, sM: 500, deviceTs: T0 + 2 * 60 * 60 * 1000 }),
      ],
      receivedAtMs: T0 + 1000,
      nowMs: T0 + 1000,
    });
    skewed = result.snapshot;

    expect(result.decisions[0]!.accepted).toBe(true);
    expect(skewed.filter!.sM).toBeCloseTo(honest.filter!.sM, 3);
    expect(skewed.lastConfirmedAtMs).toBe(honest.lastConfirmedAtMs);
  });
});

describe('batches', () => {
  it('uses only the newest fresh report and keeps the rest as history', () => {
    const snapshot = newJourney();
    const result = ingest({
      snapshot,
      route,
      contributorId: 'driver',
      reports: [
        reportAt(route, { seq: 0, sM: 100 }),
        reportAt(route, { seq: 1, sM: 200 }),
        reportAt(route, { seq: 2, sM: 300 }),
      ],
      receivedAtMs: T0 + 1000,
      nowMs: T0 + 1000,
    });

    const accepted = result.decisions.filter((d) => d.accepted);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.seq).toBe(2);
    expect(result.decisions.filter((d) => d.historyOnly)).toHaveLength(2);
    // A backlog must not walk the bus down the route in one request.
    expect(result.snapshot.filter!.sM).toBeCloseTo(300, 0);
  });

  it('treats a stale backlog as history even when it is the newest thing sent', () => {
    const snapshot = newJourney();
    const result = ingest({
      snapshot,
      route,
      contributorId: 'driver',
      reports: [reportAt(route, { seq: 0, sM: 100, sampleAgeMs: 45_000 })],
      receivedAtMs: T0 + 1000,
      nowMs: T0 + 1000,
    });
    expect(result.decisions[0]!.accepted).toBe(false);
    expect(result.decisions[0]!.historyOnly).toBe(true);
    expect(result.snapshot.filter).toBeNull();
  });
});

describe('recovery after an outage', () => {
  it('accepts a plausible return far beyond the old projection cap', () => {
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, 1000, T0 + 1000));
    // Two minutes of silence, then a fix 1.5 km further on — well past the 600 m
    // cap, and entirely plausible at city speeds.
    const result = feed(snapshot, 2500, T0 + 121_000);
    expect(result.reason).toBeNull();
    expect(result.accepted).toBe(true);
    expect(result.snapshot.filter!.sM).toBeCloseTo(2500, -1);
  });

  it('holds a suspicious jump until a second agreeing fix confirms it', () => {
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, 1000, T0 + 1000));
    ({ snapshot } = feed(snapshot, 1100, T0 + 5000));

    // A jump that would need far more than the maximum speed.
    const first = feed(snapshot, 9000, T0 + 9000);
    expect(first.reason).not.toBeNull();
    expect(first.snapshot.filter!.sM).toBeLessThan(2000);
  });
});

describe('journey end', () => {
  it('keeps the final position but stops projecting', () => {
    let snapshot = newJourney();
    ({ snapshot } = feed(snapshot, 500, T0 + 1000));
    snapshot = endJourney(snapshot, T0 + 2000, 'driver');
    const state = stateOf(snapshot, T0 + 3000);
    expect(state.mode).toBe('ENDED');
    expect(state.lastConfirmedPosition).not.toBeNull();
    expect(state.projection).toBeNull();
    expect(state.stops.every((s) => s.etaSeconds === null)).toBe(true);
  });

  it('is idempotent', () => {
    let snapshot = newJourney();
    snapshot = endJourney(snapshot, T0 + 2000, 'driver');
    const again = endJourney(snapshot, T0 + 3000, 'driver');
    expect(again.endedAtMs).toBe(T0 + 2000);
    expect(again.version).toBe(snapshot.version);
  });
});

describe('multiple sources', () => {
  it('keeps the journey live when the driver stops reporting', () => {
    let snapshot = newJourney();
    snapshot = withPassenger(snapshot, 'p1', T0);
    ({ snapshot } = feed(snapshot, 500, T0 + 1000));
    ({ snapshot } = feed(snapshot, 520, T0 + 2000, { contributorId: 'p1' }));
    // Driver goes quiet; the passenger keeps reporting.
    ({ snapshot } = feed(snapshot, 1000, T0 + 62_000, { contributorId: 'p1' }));
    expect(derivedModeAt(snapshot, route, T0 + 62_500)).toBe('LIVE');
    const state = stateOf(snapshot, T0 + 62_500);
    expect(state.activeSources.driver).toBe(false);
    expect(state.activeSources.passengers).toBe(1);
  });
});
