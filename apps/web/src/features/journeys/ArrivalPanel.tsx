import type { JourneyMode, StopEta } from '@buskothay/shared';
import { en } from '../../content/en.js';
import { formatAccuracy, formatDistance, formatEtaRange } from '../../lib/format.js';
import './arrival-panel.css';

/**
 * The selected stop, its arrival, and how much the number can be trusted.
 *
 * This is the part of the journey sheet a person reads without opening anything,
 * so it holds three facts and no more: which stop, how long, and how far. When
 * there is no honest answer the number is replaced by a sentence — never left
 * underneath a warning as a tempting figure a person might read anyway.
 *
 * The tracking state itself is shown once, in the status strip over the map.
 */

export interface ArrivalPanelProps {
  readonly stop: StopEta | null;
  readonly mode: JourneyMode;
  readonly confidenceM: number | null;
  readonly offRoute: boolean;
}

export function ArrivalPanel(props: ArrivalPanelProps) {
  const eta =
    props.stop === null
      ? null
      : formatEtaRange(props.stop.etaSeconds, props.stop.etaRangeSeconds);
  const distance = props.stop === null ? null : formatDistance(props.stop.distanceM);
  const accuracy = formatAccuracy(props.confidenceM);
  const isApproximate = props.mode === 'ESTIMATED' || props.mode === 'STALE';

  const unavailableReason = arrivalUnavailableReason(props);
  // Age is not repeated here: the status strip over the map already carries it.
  const details = [
    distance === null ? null : en.arrival.distanceAway(distance),
    isApproximate && accuracy !== null ? en.freshness.approximateAccuracy(accuracy) : null,
  ].filter((part): part is string => part !== null);

  return (
    <section className="arrival" aria-labelledby="arrival-heading">
      <div className="arrival__row">
        <h2 id="arrival-heading" className="arrival__stop-name">
          {props.stop?.name ?? en.route.selectedStop}
        </h2>
        {unavailableReason === null && eta !== null ? (
          <p className="arrival__eta">
            <span className="arrival__eta-number">{eta}</span>
            <span className="arrival__eta-unit">{en.arrival.unit}</span>
          </p>
        ) : null}
      </div>

      {unavailableReason === null ? null : (
        <p className="arrival__unavailable">{unavailableReason}</p>
      )}

      {details.length === 0 ? null : <p className="arrival__meta">{details.join(' · ')}</p>}
    </section>
  );
}

/** Why there is no arrival time, said plainly. Null means there is one. */
function arrivalUnavailableReason(props: ArrivalPanelProps): string | null {
  if (props.offRoute) return `${en.journeys.offRoute} ${en.journeys.offRouteHelp}`;
  if (props.mode === 'PENDING') return en.journeys.waitingFirstFix;
  if (props.mode === 'ENDED') return en.journeys.ended;
  if (props.mode === 'STALE') return en.freshness.staleMessage;
  if (props.stop === null) return en.route.chooseStop;
  if (props.stop.status === 'passed') return en.arrival.passed;
  if (props.stop.etaSeconds === null && props.stop.etaRangeSeconds === null) {
    return props.stop.status === 'near' ? en.arrival.near : en.arrival.unavailable;
  }
  return null;
}
