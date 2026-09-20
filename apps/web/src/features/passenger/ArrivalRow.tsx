import { Link } from 'react-router-dom';
import type { Arrival } from '@buskothay/shared';
import { en } from '../../content/en.js';
import { arrivalAt } from '../../lib/format.js';
import { LiveStatus } from './LiveStatus.js';
import { canShowArrival } from './liveness.js';
import './arrival-row.css';

/**
 * One bus on the departure board.
 *
 * Route number, where it is going, when it reaches this stop, and a way in. The
 * "near X" line is the one piece of reassurance worth the space: it is how a
 * passenger decides whether a number is plausible before trusting it.
 */
export function ArrivalRow({ arrival, nowMs }: { arrival: Arrival; nowMs: number }) {
  const showArrival = canShowArrival(arrival.mode);
  const eta = showArrival ? arrivalAt(arrival.arrival?.etaSeconds, nowMs) : null;
  const detailsHref =
    `/r/${encodeURIComponent(arrival.routeId)}` +
    `?stop=${encodeURIComponent(arrival.boardStopId)}`;

  return (
    <article className="bus-result">
      <div className="bus-result__badge">
        <span className="route-badge">{arrival.code}</span>
      </div>

      <div className="bus-result__dest">
        <div className="bus-result__towards">{en.find.towards(arrival.destination)}</div>
        <div className="bus-result__where">
          <LiveStatus mode={arrival.mode} ageSeconds={arrival.lastFixAgeSeconds} />
          {arrival.currentStopName === null ? null : (
            <span className="bus-result__near">· {en.find.nearStop(arrival.currentStopName)}</span>
          )}
        </div>
      </div>

      <div className="bus-result__eta">
        {eta === null ? (
          <span className="bus-result__eta-none">{en.find.noLiveBus}</span>
        ) : (
          <>
            <span className="bus-result__eta-clock">{eta.clock}</span>
            <span className="bus-result__eta-unit">
              {en.find.arrivingAt(arrival.boardStopName)} · ~{eta.minutes} {en.arrival.unit}
            </span>
          </>
        )}
      </div>

      <div className="bus-result__action">
        <Link className="button" to={detailsHref}>
          {en.find.details}
        </Link>
      </div>
    </article>
  );
}
