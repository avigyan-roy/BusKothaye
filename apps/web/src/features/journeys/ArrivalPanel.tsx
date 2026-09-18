import type { JourneyMode, StopEta } from '@buskothay/shared';
import { en } from '../../content/en.js';
import { StatusBadge } from '../../components/StatusBadge.js';
import { formatAccuracy, formatDistance, formatElapsed, formatEtaRange } from '../../lib/format.js';
import './arrival-panel.css';

/**
 * The selected stop, its arrival, and how much the number can be trusted.
 *
 * When there is no honest answer the number is replaced by a sentence — never
 * left underneath an error as a tempting figure a person might read anyway.
 */

export interface ArrivalPanelProps {
  readonly stop: StopEta | null;
  readonly mode: JourneyMode;
  readonly ageSeconds: number | null;
  readonly confidenceM: number | null;
  readonly offRoute: boolean;
  readonly isReconnecting: boolean;
  readonly onChangeStop: () => void;
}

export function ArrivalPanel(props: ArrivalPanelProps) {
  const eta = props.stop === null ? null : formatEtaRange(props.stop.etaSeconds, props.stop.etaRangeSeconds);
  const distance = props.stop === null ? null : formatDistance(props.stop.distanceM);
  const age = formatElapsed(props.ageSeconds);
  const accuracy = formatAccuracy(props.confidenceM);

  const unavailableReason = arrivalUnavailableReason(props);

  return (
    <section className="arrival" aria-labelledby="arrival-heading">
      <div className="arrival__head">
        <h2 id="arrival-heading" className="arrival__stop-name">
          {props.stop?.name ?? en.route.selectedStop}
        </h2>
        <button type="button" className="button button--text" onClick={props.onChangeStop}>
          {en.route.change}
        </button>
      </div>

      {unavailableReason === null && eta !== null ? (
        <p className="arrival__eta">
          <span className="arrival__eta-number">{eta}</span>{' '}
          <span className="arrival__eta-unit">{en.arrival.unit}</span>
        </p>
      ) : (
        <p className="arrival__unavailable">{unavailableReason ?? en.arrival.unavailable}</p>
      )}

      <p className="arrival__status">
        <StatusBadge
          mode={props.mode}
          detail={
            props.mode === 'STALE' || props.mode === 'ESTIMATED'
              ? age === null
                ? null
                : en.freshness.lastConfirmedAgo(age)
              : age === null
                ? null
                : en.freshness.confirmedAgo(age)
          }
        />
        {props.isReconnecting ? (
          <span className="arrival__reconnecting"> · {en.freshness.reconnecting}</span>
        ) : null}
      </p>

      <p className="meta arrival__detail">
        {distance === null ? null : en.arrival.distanceAway(distance)}
        {accuracy !== null && (props.mode === 'ESTIMATED' || props.mode === 'STALE')
          ? ` · ${en.freshness.approximateAccuracy(accuracy)}`
          : null}
      </p>

      {props.mode === 'STALE' ? (
        <p className="notice notice--warning">{en.freshness.staleMessage}</p>
      ) : null}
      {props.offRoute ? (
        <p className="notice notice--warning">
          {en.journeys.offRoute} {en.journeys.offRouteHelp}
        </p>
      ) : null}
    </section>
  );
}

/** Why there is no arrival time, said plainly. Null means there is one. */
function arrivalUnavailableReason(props: ArrivalPanelProps): string | null {
  if (props.offRoute) return en.journeys.offRoute;
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
