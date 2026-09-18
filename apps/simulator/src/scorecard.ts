import { ACCURACY_REJECT_M, type JourneyMode } from '@buskothay/shared';
import { isBlackout, type RunResult, type Sample } from './runner.js';
import { isInWindow } from './scenario.js';

/**
 * Turning a run into numbers, and then into a pass or a fail.
 *
 * Two rules matter here. A metric with no samples behind it is `null`, never
 * zero — "no LIVE samples" must not be reported as "zero metres of error". And an
 * expectation that cannot be evaluated counts as a failure, not as a pass by
 * default.
 */

export interface Scorecard {
  readonly scenario: string;
  readonly seed: number;
  readonly durationS: number;
  readonly journeyId: string;
  readonly sampleCount: number;
  readonly liveSampleCount: number;
  readonly liveP50ErrorM: number | null;
  readonly liveP95ErrorM: number | null;
  readonly blackoutMaxErrorM: number | null;
  readonly recoverySeconds: number | null;
  readonly spoofRejectionRate: number | null;
  readonly falseRejectionRate: number | null;
  /**
   * Fraction of live samples whose actual error fell inside the published
   * confidence. For a well-behaved one-sigma figure this sits near 0.68. It is a
   * measurement of our own calibration, not a promise to a passenger.
   */
  readonly confidenceCoverage: number | null;
  readonly modeTimeline: readonly { tS: number; mode: JourneyMode }[];
  readonly failures: readonly string[];
  readonly passed: boolean;
}

const TRACKING: JourneyMode[] = ['LIVE', 'DWELLING'];

export function buildScorecard(run: RunResult): Scorecard {
  const { scenario, samples } = run;

  const liveSamples = samples.filter(
    (s): s is Sample & { errorM: number } =>
      TRACKING.includes(s.mode) && s.errorM !== null,
  );
  const liveErrors = liveSamples.map((s) => Math.abs(s.errorM)).sort((a, b) => a - b);

  const blackoutSamples = samples.filter(
    (s) => s.errorM !== null && isBlackout(scenario, s.tS),
  );
  const blackoutMaxErrorM =
    blackoutSamples.length === 0
      ? null
      : Math.max(...blackoutSamples.map((s) => Math.abs(s.errorM!)));

  const failures: string[] = [];

  // --- Mode windows ---------------------------------------------------------
  for (const window of scenario.expect.modeWindows) {
    const inWindow = samples.filter((s) => s.tS >= window.fromS && s.tS < window.toS);
    if (inWindow.length === 0) {
      failures.push(
        `no samples between ${window.fromS}s and ${window.toS}s, so the expected mode could not be checked`,
      );
      continue;
    }
    const wrong = inWindow.filter((s) => !window.modes.includes(s.mode));
    if (wrong.length > 0) {
      const seen = [...new Set(wrong.map((s) => s.mode))].join(', ');
      failures.push(
        `between ${window.fromS}s and ${window.toS}s expected ${window.modes.join('/')} but saw ${seen}`,
      );
    }
  }

  // --- Error targets --------------------------------------------------------
  const liveP50ErrorM = percentile(liveErrors, 0.5);
  const liveP95ErrorM = percentile(liveErrors, 0.95);

  if (scenario.expect.maxLiveP95ErrorM !== undefined) {
    if (liveP95ErrorM === null) {
      failures.push('no LIVE samples, so the live error target could not be measured');
    } else if (liveP95ErrorM > scenario.expect.maxLiveP95ErrorM) {
      failures.push(
        `live p95 error ${liveP95ErrorM.toFixed(0)} m exceeds the ${scenario.expect.maxLiveP95ErrorM} m target`,
      );
    }
  }

  if (scenario.expect.maxBlackoutErrorM !== undefined) {
    if (blackoutMaxErrorM === null) {
      failures.push('no samples inside the blackout window, so its error was not measured');
    } else if (blackoutMaxErrorM > scenario.expect.maxBlackoutErrorM) {
      failures.push(
        `blackout error reached ${blackoutMaxErrorM.toFixed(0)} m, above the ${scenario.expect.maxBlackoutErrorM} m target`,
      );
    }
  }

  // --- Recovery -------------------------------------------------------------
  const recoverySeconds = measureRecovery(run);
  if (scenario.expect.maxRecoveryS !== undefined) {
    if (recoverySeconds === null) {
      failures.push('the journey never returned to LIVE after the blackout');
    } else if (recoverySeconds > scenario.expect.maxRecoveryS) {
      failures.push(
        `recovery took ${recoverySeconds.toFixed(1)} s, above the ${scenario.expect.maxRecoveryS} s target`,
      );
    }
  }

  // --- Rejection rates, read from the server's own diagnostics ---------------
  const dishonestLabels = new Set<string>();
  const honestLabels = new Set<string>();
  scenario.sources.forEach((spec, index) => {
    const label = `source-${index + 1}`;
    // A source is counted as "expected to be refused" when it is dishonest or when
    // the scenario deliberately makes its fixes unusable — a phone reporting 150 m
    // accuracy is not lying, but its reports are supposed to be rejected, so
    // counting them as false rejections would be measuring the wrong thing.
    const expectedToBeRefused =
      spec.spoof !== undefined || (spec.forceAccuracyM ?? 0) > ACCURACY_REJECT_M;
    if (expectedToBeRefused) dishonestLabels.add(label);
    else honestLabels.add(label);
  });

  const spoofRejectionRate = rejectionRate(run, dishonestLabels);
  const falseRejectionRate = rejectionRate(run, honestLabels);

  if (scenario.expect.minSpoofRejectionRate !== undefined) {
    if (spoofRejectionRate === null) {
      failures.push('no reports from the dishonest source reached the server');
    } else if (spoofRejectionRate < scenario.expect.minSpoofRejectionRate) {
      failures.push(
        `only ${(spoofRejectionRate * 100).toFixed(0)}% of spoofed reports were refused, below the ${(scenario.expect.minSpoofRejectionRate * 100).toFixed(0)}% target`,
      );
    }
  }
  if (scenario.expect.maxFalseRejectionRate !== undefined) {
    if (falseRejectionRate === null) {
      failures.push('no honest reports reached the server');
    } else if (falseRejectionRate > scenario.expect.maxFalseRejectionRate) {
      failures.push(
        `${(falseRejectionRate * 100).toFixed(1)}% of honest reports were refused, above the ${(scenario.expect.maxFalseRejectionRate * 100).toFixed(1)}% target`,
      );
    }
  }

  // --- Stop-pass claims -----------------------------------------------------
  for (const window of scenario.expect.noStopPassedWindows) {
    const baseline = samples.find((s) => s.tS >= window.fromS)?.passedStopCount ?? 0;
    const offending = samples.filter(
      (s) => isInWindow([window], s.tS) && s.passedStopCount > baseline,
    );
    if (offending.length > 0) {
      failures.push(
        `a stop was reported passed between ${window.fromS}s and ${window.toS}s without confirming evidence`,
      );
    }
  }

  // --- Journey isolation ----------------------------------------------------
  if (scenario.expect.requireJourneyIsolation) {
    const secondMoved = run.secondJourneySamples.some((s) => s.estimateSM !== null);
    if (secondMoved) {
      failures.push('the second journey acquired a position from the first journey');
    }
    if (run.secondJourneySamples.length === 0) {
      failures.push('the second journey was never polled, so isolation was not checked');
    }
  }

  const confidenceCoverage =
    liveSamples.length === 0
      ? null
      : liveSamples.filter(
          (s) => s.confidenceM !== null && Math.abs(s.errorM) <= s.confidenceM,
        ).length / liveSamples.length;

  if (run.transportErrors.length > 0) {
    failures.push(`${run.transportErrors.length} transport error(s) during the run`);
  }

  return {
    scenario: scenario.name,
    seed: scenario.seed,
    durationS: scenario.durationS,
    journeyId: run.journeyId,
    sampleCount: samples.length,
    liveSampleCount: liveSamples.length,
    liveP50ErrorM,
    liveP95ErrorM,
    blackoutMaxErrorM,
    recoverySeconds,
    spoofRejectionRate,
    falseRejectionRate,
    confidenceCoverage,
    modeTimeline: samples.map((s) => ({ tS: s.tS, mode: s.mode })),
    failures,
    passed: failures.length === 0,
  };
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[index]!;
}

/** Seconds from the end of the last blackout to the journey being LIVE again. */
function measureRecovery(run: RunResult): number | null {
  const blackouts = run.scenario.blackouts;
  if (blackouts.length === 0) return null;
  const lastEnd = Math.max(...blackouts.map((b) => b.toS));
  const recovered = run.samples.find((s) => s.tS >= lastEnd && s.mode === 'LIVE');
  return recovered === undefined ? null : recovered.tS - lastEnd;
}

function rejectionRate(run: RunResult, labels: ReadonlySet<string>): number | null {
  if (run.debug === null || labels.size === 0) return null;
  let accepted = 0;
  let rejected = 0;
  for (const source of run.debug.sources) {
    if (!labels.has(source.label)) continue;
    accepted += source.acceptedCount;
    rejected += source.rejectedCount;
  }
  const total = accepted + rejected;
  return total === 0 ? null : rejected / total;
}
