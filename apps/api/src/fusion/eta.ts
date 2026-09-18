import {
  ETA_DWELL_PER_STOP_S,
  ETA_MAX_SPEED_MPS,
  ETA_MIN_SPEED_MPS,
  ETA_RANGE_FRACTION_ESTIMATED,
  ETA_RANGE_FRACTION_LIVE,
  ETA_WEIGHT_JOURNEY,
  ETA_WEIGHT_NOW,
  ETA_WEIGHT_SEGMENT,
  STOP_NEAR_M,
  meanSegmentSpeedMps,
  segmentDwellAllowanceS,
  stopsBetween,
  type JourneyMode,
  type RouteDto,
  type StopEta,
} from '@buskothay/shared';

/**
 * Arrival estimates.
 *
 * Along a known polyline this is arithmetic, not machine learning: remaining
 * distance, an effective speed, and an allowance for the stops in between. What
 * matters is the honesty of the output — a range rather than a point, `null`
 * rather than a guess, and never a claim that a stop has been passed on the
 * strength of a prediction.
 */

export interface EtaInput {
  readonly route: RouteDto;
  readonly mode: JourneyMode;
  /** Current bounded position along the route, or null when unknown. */
  readonly sM: number | null;
  /** Filter speed at the anchor, metres per second. */
  readonly vMps: number | null;
  /** Slow average over this journey so far, metres per second. */
  readonly journeyMeanMps: number | null;
  readonly offRoute: boolean;
  /** Stops confirmed passed by accepted evidence. Never by a prediction. */
  readonly passedStopIds: ReadonlySet<string>;
  /**
   * False until the journey has seen enough accepted fixes to have measured a
   * speed. A journey one fix old has a filter speed of zero, which is the absence
   * of evidence rather than evidence of a stopped bus, so the authored segment
   * speed answers on its own until movement has actually been observed.
   */
  readonly speedEstablished: boolean;
  readonly nowMs: number;
}

/** Whether the current mode can support a tracking-based arrival estimate at all. */
function etaIsAvailable(input: EtaInput): boolean {
  if (input.sM === null) return false;
  if (input.offRoute) return false;
  return input.mode === 'LIVE' || input.mode === 'DWELLING' || input.mode === 'ESTIMATED';
}

/**
 * Effective speed for the stretch ahead.
 *
 * While dwelling, current speed is zero and using it would divide by zero and
 * produce an infinite arrival, so the authored segment speed is used on its own —
 * the bus is stopped, but it is going to move again.
 */
export function effectiveSpeedMps(input: EtaInput, toSM: number): number {
  const fromSM = input.sM ?? 0;
  const segment = meanSegmentSpeedMps(input.route, fromSM, toSM);
  if (input.mode === 'DWELLING' || !input.speedEstablished) {
    return clampSpeed(segment);
  }
  const now = input.vMps ?? segment;
  const journey = input.journeyMeanMps ?? now;
  return clampSpeed(
    ETA_WEIGHT_NOW * now + ETA_WEIGHT_JOURNEY * journey + ETA_WEIGHT_SEGMENT * segment,
  );
}

function clampSpeed(v: number): number {
  if (!Number.isFinite(v)) return ETA_MIN_SPEED_MPS;
  return Math.min(ETA_MAX_SPEED_MPS, Math.max(ETA_MIN_SPEED_MPS, v));
}

/** Allowance for the stops between here and there, seconds. */
function dwellAllowanceS(input: EtaInput, toSM: number): number {
  const fromSM = input.sM ?? 0;
  const authored = segmentDwellAllowanceS(input.route, fromSM, toSM);
  if (authored > 0) return authored;
  return stopsBetween(input.route, fromSM, toSM).length * ETA_DWELL_PER_STOP_S;
}

function rangeFraction(mode: JourneyMode): number {
  return mode === 'ESTIMATED' ? ETA_RANGE_FRACTION_ESTIMATED : ETA_RANGE_FRACTION_LIVE;
}

/** Arrival rows for every checkpoint on the route, in route order. */
export function computeStopEtas(input: EtaInput): StopEta[] {
  const available = etaIsAvailable(input);
  const hasVerifiedSchedule =
    input.route.schedule !== null && input.route.schedule.isIllustrative === false;

  return input.route.stops.map((stop): StopEta => {
    const passed = input.passedStopIds.has(stop.id);
    const distanceM = input.sM === null ? null : stop.sM - input.sM;

    if (passed) {
      return {
        stopId: stop.id,
        name: stop.name,
        distanceM,
        status: 'passed',
        etaSeconds: null,
        etaRangeSeconds: null,
        scheduledTs: null,
        basis: 'unavailable',
      };
    }

    if (input.sM === null) {
      return {
        stopId: stop.id,
        name: stop.name,
        distanceM: null,
        status: 'unknown',
        etaSeconds: null,
        etaRangeSeconds: null,
        scheduledTs: null,
        // A route with a real timetable could answer from the schedule here.
        basis: hasVerifiedSchedule ? 'schedule' : 'unavailable',
      };
    }

    const remainingM = stop.sM - input.sM;
    // Zero remaining distance at an estimated cap means "near the stop,
    // unconfirmed" — not passed, and not a guaranteed arrival.
    const status: StopEta['status'] =
      Math.abs(remainingM) <= STOP_NEAR_M ? 'near' : remainingM > 0 ? 'upcoming' : 'near';

    if (!available || remainingM <= 0) {
      return {
        stopId: stop.id,
        name: stop.name,
        distanceM,
        status,
        etaSeconds: null,
        etaRangeSeconds: null,
        scheduledTs: null,
        basis: hasVerifiedSchedule ? 'schedule' : 'unavailable',
      };
    }

    const speed = effectiveSpeedMps(input, stop.sM);
    const travelS = remainingM / speed;
    const etaSeconds = travelS + dwellAllowanceS(input, stop.sM);
    if (!Number.isFinite(etaSeconds)) {
      return {
        stopId: stop.id,
        name: stop.name,
        distanceM,
        status,
        etaSeconds: null,
        etaRangeSeconds: null,
        scheduledTs: null,
        basis: 'unavailable',
      };
    }

    const fraction = rangeFraction(input.mode);
    const low = Math.max(0, etaSeconds * (1 - fraction));
    const high = etaSeconds * (1 + fraction);

    return {
      stopId: stop.id,
      name: stop.name,
      distanceM,
      status,
      etaSeconds,
      etaRangeSeconds: [low, high],
      scheduledTs: null,
      basis: input.mode === 'ESTIMATED' ? 'estimated' : 'live',
    };
  });
}

/**
 * Schedule delay.
 *
 * AC24 has no verified timetable in this build, so this is always null and the UI
 * says "Schedule unavailable" rather than "On time". Wiring a real timetable in
 * means returning the signed difference here and nothing else.
 */
export function computeDelaySeconds(route: RouteDto): number | null {
  if (route.schedule === null || route.schedule.isIllustrative) return null;
  return null;
}
