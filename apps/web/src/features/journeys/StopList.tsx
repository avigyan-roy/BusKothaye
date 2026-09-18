import type { RouteDto, StopEta } from '@buskothay/shared';
import { en } from '../../content/en.js';
import { formatDistance, formatEtaRange } from '../../lib/format.js';
import './stop-list.css';

/**
 * The route's checkpoints as a flat, keyboard-navigable list.
 *
 * It is the textual equivalent of the map: everything a person can learn by
 * looking at the map is available here, which is what keeps the page usable when
 * the map cannot draw.
 */
export function StopList({
  route,
  stops,
  selectedStopId,
  onSelect,
}: {
  route: RouteDto;
  stops: readonly StopEta[];
  selectedStopId: string | null;
  onSelect: (stopId: string) => void;
}) {
  return (
    <section className="stop-list" aria-labelledby="stop-list-heading">
      <h2 id="stop-list-heading" className="stop-list__heading">
        {en.route.chooseStop}
      </h2>
      <ul className="stop-list__items">
        {stops.map((stop) => {
          const eta = formatEtaRange(stop.etaSeconds, stop.etaRangeSeconds);
          const distance = formatDistance(stop.distanceM);
          const isSelected = stop.stopId === selectedStopId;
          return (
            <li key={stop.stopId}>
              <button
                type="button"
                className={`stop-row${isSelected ? ' stop-row--selected' : ''}`}
                aria-pressed={isSelected}
                onClick={() => onSelect(stop.stopId)}
              >
                <span className="stop-row__marker" aria-hidden="true">
                  <span
                    className={`stop-row__dot${stop.status === 'passed' ? ' stop-row__dot--passed' : ''}`}
                  />
                </span>
                <span className="stop-row__body">
                  <span className="stop-row__name">
                    {stop.name}
                    {isSelected ? (
                      <span className="stop-row__selected-label"> · {en.route.selectedStop}</span>
                    ) : null}
                  </span>
                  <span className="stop-row__secondary">{secondaryLine(stop, distance)}</span>
                </span>
                <span className="stop-row__eta">
                  {eta === null ? (
                    <span className="stop-row__eta-none">—</span>
                  ) : (
                    <>
                      <span className="stop-row__eta-number">{eta}</span>
                      <span className="stop-row__eta-unit"> {en.arrival.unit}</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="meta stop-list__note">{en.route.checkpointsNote}</p>
      {route.provenance.isApproximateGeometry ? (
        <p className="meta stop-list__note">{en.route.approximateNote}</p>
      ) : null}
    </section>
  );
}

function secondaryLine(stop: StopEta, distance: string | null): string {
  if (stop.status === 'passed') return en.arrival.passed;
  if (stop.status === 'unknown') return en.route.scheduleUnavailable;
  if (stop.status === 'near') return distance === null ? en.arrival.near : `${en.arrival.near} · ${distance}`;
  return distance === null ? en.arrival.upcoming : distance;
}
