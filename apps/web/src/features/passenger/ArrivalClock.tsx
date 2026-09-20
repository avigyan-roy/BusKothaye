import type { JourneyMode, StopEta } from '@buskothay/shared';
import { en } from '../../content/en.js';
import { arrivalAt, formatDistance } from '../../lib/format.js';
import { livenessOf } from './liveness.js';
import './arrival-clock.css';

/**
 * The answer: one clock time.
 *
 * Every state this can be in still occupies the same place on the screen, so a
 * passenger's eye lands on the answer whether or not there is one. When there
 * is no honest number the slot says so in words — it is never left holding a
 * stale figure under a warning, because the figure is what gets read.
 */
export function ArrivalClock({
  stop,
  mode,
  size = 'panel',
  nowMs,
}: {
  stop: StopEta | null;
  mode: JourneyMode | null;
  size?: 'panel' | 'hero';
  nowMs: number;
}) {
  const liveness = livenessOf(mode);
  const view = arrivalView(stop, mode, nowMs);

  return (
    <p className={`arrival-clock arrival-clock--${size} is-${view.tone}`}>
      <span className="arrival-clock__value">{view.value}</span>
      <span className="arrival-clock__unit">{view.unit}</span>
      {view.sub === null ? null : <span className="arrival-clock__sub">{view.sub}</span>}
      {liveness === 'stale' ? (
        <span className="visually-hidden">{en.freshness.positionMayBeOld}</span>
      ) : null}
    </p>
  );
}

interface ArrivalView {
  readonly value: string;
  readonly unit: string;
  readonly sub: string | null;
  readonly tone: 'clock' | 'now' | 'muted';
}

export function arrivalView(
  stop: StopEta | null,
  mode: JourneyMode | null,
  nowMs: number,
): ArrivalView {
  const liveness = livenessOf(mode);
  if (liveness === 'none' || stop === null) {
    return {
      value: '--:--',
      unit: en.find.noArrivalTime,
      sub: noArrivalReason(mode),
      tone: 'muted',
    };
  }
  if (stop.status === 'passed') {
    return { value: en.find.gone, unit: en.find.busHasPassed, sub: null, tone: 'muted' };
  }
  if (stop.status === 'near') {
    return { value: en.find.now, unit: en.find.atYourStop, sub: null, tone: 'now' };
  }
  const arrival = arrivalAt(stop.etaSeconds, nowMs);
  if (arrival === null) {
    return {
      value: '--:--',
      unit: en.find.noArrivalTime,
      sub: en.arrival.unavailable,
      tone: 'muted',
    };
  }
  const distance = formatDistance(stop.distanceM);
  return {
    value: arrival.clock,
    unit: liveness === 'stale' ? en.find.arrivalEstimateOld : en.find.expectedArrival,
    sub:
      distance === null
        ? en.find.minutesAway(arrival.minutes)
        : `${en.find.minutesAway(arrival.minutes)} · ${distance}`,
    tone: 'clock',
  };
}

/** Why there is no time, said plainly. Each case is a different situation. */
function noArrivalReason(mode: JourneyMode | null): string {
  switch (mode) {
    case 'PENDING':
      return en.journeys.waitingFirstFix;
    case 'STALE':
      return en.freshness.staleMessage;
    case 'ENDED':
      return en.journeys.ended;
    default:
      return en.journeys.none;
  }
}
