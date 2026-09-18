import {
  KALMAN_INITIAL_POSITION_VAR,
  KALMAN_INITIAL_SPEED_VAR,
  KALMAN_PROCESS_NOISE,
  MAX_SPEED_MPS,
} from '@buskothay/shared';

/**
 * A constant-velocity Kalman filter on `[sM, vMps]`, one dimension along the route.
 *
 * It earns its place for three reasons at once: it smooths noisy fixes, it gives a
 * speed estimate nobody has to derive separately, and its covariance grows on its
 * own while no measurement arrives — which is where the published confidence and
 * the whole outage design come from. Fusing distance along the route rather than
 * latitude and longitude is what makes one dimension enough.
 *
 * Everything here is pure. No clock, no route, no I/O.
 */

/** Row-major 2x2 covariance, the shape that travels on the wire. */
export type Covariance = readonly [number, number, number, number];

export interface FilterState {
  readonly sM: number;
  readonly vMps: number;
  readonly covariance: Covariance;
}

export function initialFilter(sM: number, vMps = 0): FilterState {
  return {
    sM,
    vMps,
    covariance: [KALMAN_INITIAL_POSITION_VAR, 0, 0, KALMAN_INITIAL_SPEED_VAR],
  };
}

/**
 * A wide reset after a confirmed jump. The filter must not argue with reality, so
 * we hand it the measurement and a covariance that says we are not sure yet.
 */
export function resetFilter(sM: number, vMps: number, positionVar: number): FilterState {
  return {
    sM,
    vMps: clampSpeed(vMps),
    covariance: [
      Math.max(positionVar, KALMAN_INITIAL_POSITION_VAR),
      0,
      0,
      KALMAN_INITIAL_SPEED_VAR,
    ],
  };
}

function clampSpeed(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(MAX_SPEED_MPS, Math.max(0, v));
}

function clampPosition(s: number, routeLengthM: number): number {
  if (!Number.isFinite(s)) return 0;
  return Math.min(routeLengthM, Math.max(0, s));
}

/** Advance the state by `dtS` seconds with no measurement. */
export function predict(
  state: FilterState,
  dtS: number,
  routeLengthM: number,
  processNoise = KALMAN_PROCESS_NOISE,
): FilterState {
  const dt = Math.max(0, dtS);
  const [p00, p01, p10, p11] = state.covariance;
  const q = processNoise;

  const n00 = p00 + dt * (p01 + p10) + dt * dt * p11 + (q * dt ** 3) / 3;
  const n01 = p01 + dt * p11 + (q * dt ** 2) / 2;
  const n10 = p10 + dt * p11 + (q * dt ** 2) / 2;
  const n11 = p11 + q * dt;

  return {
    sM: clampPosition(state.sM + state.vMps * dt, routeLengthM),
    vMps: clampSpeed(state.vMps),
    covariance: sane([n00, n01, n10, n11]),
  };
}

export interface UpdateResult {
  readonly state: FilterState;
  /** Measurement minus prediction, metres. The basis of the reconciliation branch. */
  readonly innovationM: number;
  /** Standard deviation of the innovation, metres. */
  readonly innovationSigmaM: number;
}

/** Fold one fused measurement of position into the state. */
export function update(
  state: FilterState,
  measuredSM: number,
  measurementSigmaM: number,
  routeLengthM: number,
): UpdateResult {
  const [p00, p01, p10, p11] = state.covariance;
  const r = Math.max(1, measurementSigmaM * measurementSigmaM);

  const innovationM = measuredSM - state.sM;
  const s = p00 + r;
  const innovationSigmaM = Math.sqrt(Math.max(1e-6, s));

  const k0 = p00 / s;
  const k1 = p10 / s;

  const nextS = state.sM + k0 * innovationM;
  const nextV = state.vMps + k1 * innovationM;

  const n00 = (1 - k0) * p00;
  const n01 = (1 - k0) * p01;
  const n10 = p10 - k1 * p00;
  const n11 = p11 - k1 * p01;

  return {
    state: {
      sM: clampPosition(nextS, routeLengthM),
      vMps: clampSpeed(nextV),
      covariance: sane([n00, n01, n10, n11]),
    },
    innovationM,
    innovationSigmaM,
  };
}

/** Published confidence: the standard deviation of the along-route position. */
export function sigmaM(state: FilterState): number {
  return Math.sqrt(Math.max(0, state.covariance[0]));
}

/**
 * Keep the covariance finite, symmetric and positive on its diagonal.
 *
 * A filter that has gone non-finite must not be allowed to publish a confidence
 * number; resetting to the wide initial variance is honest, silently emitting NaN
 * is not.
 */
function sane(c: readonly [number, number, number, number]): Covariance {
  const [a, b, d, e] = c;
  const finite = [a, b, d, e].every(Number.isFinite);
  if (!finite) return [KALMAN_INITIAL_POSITION_VAR, 0, 0, KALMAN_INITIAL_SPEED_VAR];
  const off = (b + d) / 2;
  return [Math.max(1e-3, a), off, off, Math.max(1e-3, e)];
}
