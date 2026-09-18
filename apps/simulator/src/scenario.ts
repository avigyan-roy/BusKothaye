import { z } from 'zod';

/**
 * Scenario definitions.
 *
 * Scenarios live as JSON in `apps/simulator/scenarios/` so they can be edited by
 * hand without touching the runner. Expectations are declared *before* the run and
 * the process exits non-zero when they are missed — a scorecard that is written
 * after seeing the numbers measures nothing.
 */

const SpeedPhaseSchema = z.object({
  untilS: z.number().positive(),
  speedMps: z.number().nonnegative(),
});

const DwellSchema = z.object({ atS: z.number().nonnegative(), forS: z.number().positive() });

export const SourceSpecSchema = z.object({
  /** Label used in the simulator's own output. Not sent to the server. */
  name: z.string().min(1),
  role: z.enum(['driver', 'conductor', 'passenger']),
  /** Seconds between reports from this phone. */
  cadenceS: z.number().positive().default(3),
  /** Reported accuracy is drawn uniformly from this range, metres. */
  accuracyRangeM: z.tuple([z.number().positive(), z.number().positive()]).default([8, 18]),
  /** Along-track and cross-track measurement noise, metres (1 sigma). */
  alongNoiseM: z.number().nonnegative().default(6),
  crossNoiseM: z.number().nonnegative().default(6),
  /** Window in which this source reports at all. */
  activeFromS: z.number().nonnegative().default(0),
  activeUntilS: z.number().positive().default(1e9),
  /** Windows in which the phone produces nothing (tunnel, screen lock, no signal). */
  outages: z.array(z.object({ fromS: z.number(), toS: z.number() })).default([]),
  /** Buffer during these windows and send the backlog as one batch afterwards. */
  partitions: z.array(z.object({ fromS: z.number(), toS: z.number() })).default([]),
  /** Device wall-clock offset, milliseconds. Tests that skew changes nothing. */
  clockSkewMs: z.number().default(0),
  /** Reported accuracy is forced to this value, e.g. to test the 100 m gate. */
  forceAccuracyM: z.number().positive().optional(),
  /**
   * Dishonest behaviour, applied from this source's first report so the scenario
   * cannot accidentally include an honest fix during an intended blackout.
   */
  spoof: z
    .discriminatedUnion('kind', [
      /** A fixed coordinate well off the corridor. */
      z.object({ kind: z.literal('static'), lat: z.number(), lon: z.number() }),
      /** On the route, but wrong — and claiming excellent accuracy. */
      z.object({
        kind: z.literal('onroute'),
        offsetM: z.number(),
        claimedAccuracyM: z.number().positive().default(5),
      }),
      /** Teleports forward during a window, then returns to the truth. */
      z.object({
        kind: z.literal('jump'),
        fromS: z.number(),
        toS: z.number(),
        offsetM: z.number(),
      }),
    ])
    .optional(),
});
export type SourceSpec = z.infer<typeof SourceSpecSchema>;

export const ExpectationSchema = z.object({
  /** The journey must be in one of these modes throughout the window. */
  modeWindows: z
    .array(
      z.object({
        fromS: z.number().nonnegative(),
        toS: z.number().positive(),
        modes: z.array(
          z.enum(['PENDING', 'LIVE', 'DWELLING', 'ESTIMATED', 'STALE', 'ENDED']),
        ),
      }),
    )
    .default([]),
  /** 95th percentile position error while LIVE, metres. */
  maxLiveP95ErrorM: z.number().positive().optional(),
  /** Largest position error at any point in a declared blackout window, metres. */
  maxBlackoutErrorM: z.number().positive().optional(),
  /** Seconds from the first fix after a blackout to the journey being LIVE again. */
  maxRecoveryS: z.number().positive().optional(),
  /** Fraction of a dishonest source's reports that must be refused. */
  minSpoofRejectionRate: z.number().min(0).max(1).optional(),
  /** Fraction of honest reports allowed to be refused. */
  maxFalseRejectionRate: z.number().min(0).max(1).optional(),
  /** No stop may be reported passed during these windows. */
  noStopPassedWindows: z
    .array(z.object({ fromS: z.number(), toS: z.number() }))
    .default([]),
  /** Two journeys must hold independent positions. */
  requireJourneyIsolation: z.boolean().default(false),
});
export type Expectation = z.infer<typeof ExpectationSchema>;

export const ScenarioSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  seed: z.number().int(),
  durationS: z.number().positive(),
  routeId: z.string().default('ac24-patuli-howrah'),
  /** Where the imaginary bus starts, metres along the route. */
  startSM: z.number().nonnegative().default(0),
  /** Piecewise-constant true speed. The last phase covers the rest of the run. */
  speedProfile: z.array(SpeedPhaseSchema).min(1),
  /** True stops, where the bus really is stationary. */
  dwells: z.array(DwellSchema).default([]),
  /** Windows in which no source is reporting; used for blackout measurements. */
  blackouts: z.array(z.object({ fromS: z.number(), toS: z.number() })).default([]),
  sources: z.array(SourceSpecSchema).min(1),
  /** Run a second, independent journey to check they do not interfere. */
  secondJourney: z.boolean().default(false),
  expect: ExpectationSchema.default({}),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

/**
 * True distance along the route at a given time.
 *
 * Ground truth belongs to the simulator alone. It is never sent to the server in
 * any field — if it were, the measurement would be of nothing.
 */
export function truthSM(scenario: Scenario, tS: number): number {
  let sM = scenario.startSM;
  let elapsed = 0;
  const step = 0.25;
  while (elapsed < tS) {
    const dt = Math.min(step, tS - elapsed);
    const dwelling = scenario.dwells.some(
      (d) => elapsed >= d.atS && elapsed < d.atS + d.forS,
    );
    if (!dwelling) sM += speedAt(scenario, elapsed) * dt;
    elapsed += dt;
  }
  return sM;
}

export function speedAt(scenario: Scenario, tS: number): number {
  for (const phase of scenario.speedProfile) {
    if (tS < phase.untilS) return phase.speedMps;
  }
  return scenario.speedProfile[scenario.speedProfile.length - 1]!.speedMps;
}

export function isInWindow(
  windows: readonly { fromS: number; toS: number }[],
  tS: number,
): boolean {
  return windows.some((w) => tS >= w.fromS && tS < w.toS);
}
