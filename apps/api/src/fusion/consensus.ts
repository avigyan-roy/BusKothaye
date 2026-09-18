import {
  ACCURACY_FLOOR_M,
  BIMODAL_SEPARATION_M,
  CORRIDOR_BASE_M,
  FRESHNESS_TAU_S,
  MAD_FLOOR_M,
  MAD_MULTIPLIER,
  MAX_SINGLE_SOURCE_WEIGHT_SHARE,
  NEW_SOURCE_TRUST_MULTIPLIER,
  ROLE_TRUST,
  SINGLE_SOURCE_SIGMA_FLOOR_M,
  TWO_SOURCE_DISAGREEMENT_M,
  type Role,
} from '@buskothay/shared';

/**
 * Turning several sources into one position.
 *
 * The ordering here is the point, and it is the correction recorded in
 * docs/DECISIONS.md §3: consensus is established *before* accuracy weighting.
 * A source that claims five-metre accuracy has not proved anything — if weights
 * came first, one confident liar with more than half the total weight would move
 * the answer wherever it liked. So with three or more sources we find the majority
 * cluster with an unweighted median and a MAD filter, and only then use weights to
 * extract precision from the survivors, with no single source allowed more than a
 * 45% share.
 *
 * Phone identities are not verified. None of this resists a coordinated group of
 * fake contributors, and nothing in the product claims it does.
 */

export interface FusionSample {
  readonly sourceId: string;
  readonly role: Role;
  /** Projected distance along the route, metres. */
  readonly sM: number;
  readonly accuracyM: number;
  /** Perpendicular distance from the route line, metres. */
  readonly offsetM: number;
  /** Age of the measurement at the common reference time, milliseconds. */
  readonly ageMs: number;
  /** Per-journey reputation multiplier, 0.1–1.0. */
  readonly reputation: number;
  /** True while the contributor is inside its joining probation window. */
  readonly isProbationary: boolean;
}

export interface ConsensusResult {
  /** Fused position, metres along the route. */
  readonly sM: number;
  /** Measurement standard deviation to hand the filter, metres. */
  readonly sigmaM: number;
  /** Sources excluded by the majority-cluster step. */
  readonly outlierIds: readonly string[];
  /** Share of the fused answer each retained source carried, 0–1. */
  readonly weightShares: ReadonlyMap<string, number>;
  /**
   * Set when the sample set cannot be reduced to one trustworthy answer — two
   * comparable clusters, or two sources that simply disagree. The caller widens
   * uncertainty and surfaces this in diagnostics rather than averaging two buses
   * into the empty space between them.
   */
  readonly ambiguity: string | null;
}

/** Freshness, accuracy, trust, corridor and reputation, multiplied. */
export function sampleWeight(sample: FusionSample): number {
  const freshness = Math.exp(-sample.ageMs / 1000 / FRESHNESS_TAU_S);
  const accuracy = 1 / Math.max(ACCURACY_FLOOR_M, sample.accuracyM) ** 2;
  const trust =
    ROLE_TRUST[sample.role] * (sample.isProbationary ? NEW_SOURCE_TRUST_MULTIPLIER : 1);
  const corridor = 1 / (1 + (sample.offsetM / (CORRIDOR_BASE_M / 2)) ** 2);
  const weight = freshness * accuracy * trust * corridor * sample.reputation;
  return Number.isFinite(weight) && weight > 0 ? weight : Number.MIN_VALUE;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Weighted mean with a cap on any one source's share.
 *
 * The cap is applied by redistribution rather than by dropping the source: an
 * unusually precise honest phone should still count for more than a vague one,
 * just not for everything.
 */
function cappedWeightedMean(
  samples: readonly FusionSample[],
  weights: readonly number[],
): { sM: number; shares: Map<string, number> } {
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = new Map<string, number>();
  if (total <= 0 || samples.length === 0) {
    return { sM: samples[0]?.sM ?? 0, shares };
  }

  let normalised = weights.map((w) => w / total);
  if (samples.length >= 3) {
    // One pass of capping and redistribution is enough for the sizes we handle.
    const cap = MAX_SINGLE_SOURCE_WEIGHT_SHARE;
    const excess = normalised.reduce((acc, w) => acc + Math.max(0, w - cap), 0);
    if (excess > 0) {
      const uncappedTotal = normalised.reduce(
        (acc, w) => acc + (w < cap ? w : 0),
        0,
      );
      normalised = normalised.map((w) =>
        w >= cap
          ? cap
          : uncappedTotal > 0
            ? w + (excess * w) / uncappedTotal
            : w,
      );
    }
  }

  let sM = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sM += samples[i]!.sM * normalised[i]!;
    shares.set(samples[i]!.sourceId, normalised[i]!);
  }
  return { sM, shares };
}

/** Split retained samples into clusters separated by more than the given gap. */
function clusterBySeparation(
  samples: readonly FusionSample[],
  gapM: number,
): FusionSample[][] {
  const sorted = [...samples].sort((a, b) => a.sM - b.sM);
  const clusters: FusionSample[][] = [];
  let current: FusionSample[] = [];
  for (const sample of sorted) {
    const previous = current[current.length - 1];
    if (previous && sample.sM - previous.sM > gapM) {
      clusters.push(current);
      current = [];
    }
    current.push(sample);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Combine live samples into one position.
 *
 * `predictedSM` is the filter's current expectation. It is used only to break a
 * two-source tie by continuity — the source that agrees with where the bus already
 * was wins, rather than the one that merely claims better accuracy.
 */
export function combine(
  samples: readonly FusionSample[],
  predictedSM: number | null,
): ConsensusResult {
  if (samples.length === 0) {
    return {
      sM: predictedSM ?? 0,
      sigmaM: SINGLE_SOURCE_SIGMA_FLOOR_M,
      outlierIds: [],
      weightShares: new Map(),
      ambiguity: null,
    };
  }

  if (samples.length === 1) {
    const only = samples[0]!;
    return {
      sM: only.sM,
      // One source can track, but never with tight confidence: there is nothing
      // to check it against.
      sigmaM: Math.max(SINGLE_SOURCE_SIGMA_FLOOR_M, only.accuracyM),
      outlierIds: [],
      weightShares: new Map([[only.sourceId, 1]]),
      ambiguity: null,
    };
  }

  if (samples.length === 2) {
    const [a, b] = samples as [FusionSample, FusionSample];
    const separationM = Math.abs(a.sM - b.sM);
    if (separationM > TWO_SOURCE_DISAGREEMENT_M) {
      // Two sources cannot form a majority. Prefer continuity with the trajectory
      // we already believe, widen the uncertainty to cover the disagreement, and
      // say so in diagnostics.
      const chosen =
        predictedSM === null
          ? sampleWeight(a) >= sampleWeight(b)
            ? a
            : b
          : Math.abs(a.sM - predictedSM) <= Math.abs(b.sM - predictedSM)
            ? a
            : b;
      return {
        sM: chosen.sM,
        sigmaM: Math.max(SINGLE_SOURCE_SIGMA_FLOOR_M, separationM / 2),
        outlierIds: [],
        weightShares: new Map([[chosen.sourceId, 1]]),
        ambiguity: `Two sources disagree by ${separationM.toFixed(0)} m; holding the position consistent with the existing trajectory`,
      };
    }
    const weights = samples.map(sampleWeight);
    const { sM, shares } = cappedWeightedMean(samples, weights);
    return {
      sM,
      sigmaM: Math.max(SINGLE_SOURCE_SIGMA_FLOOR_M, separationM / 2, 25),
      outlierIds: [],
      weightShares: shares,
      ambiguity: null,
    };
  }

  // Three or more: unweighted majority first.
  const positions = samples.map((s) => s.sM);
  const med = median(positions);
  const mad = median(positions.map((s) => Math.abs(s - med)));
  const tolerance = Math.max(MAD_MULTIPLIER * mad, MAD_FLOOR_M);

  const kept: FusionSample[] = [];
  const outlierIds: string[] = [];
  for (const sample of samples) {
    if (Math.abs(sample.sM - med) <= tolerance) kept.push(sample);
    else outlierIds.push(sample.sourceId);
  }

  const survivors = kept.length > 0 ? kept : samples;
  const weights = survivors.map(sampleWeight);
  const { sM, shares } = cappedWeightedMean(survivors, weights);

  // Two well-populated clusters usually means two buses on the same route with
  // contributors split between them, not noise. Averaging them would put the
  // marker in a gap where no bus is.
  let ambiguity: string | null = null;
  const clusters = clusterBySeparation(survivors, BIMODAL_SEPARATION_M);
  const populated = clusters.filter((c) => c.length >= 2);
  if (populated.length >= 2) {
    ambiguity =
      `Sources form ${populated.length} separate clusters more than ` +
      `${BIMODAL_SEPARATION_M} m apart; this journey may have contributors on two different buses`;
  }

  return {
    sM,
    sigmaM: Math.max(10, standardDeviation(survivors.map((s) => s.sM))),
    outlierIds,
    weightShares: shares,
    ambiguity,
  };
}
