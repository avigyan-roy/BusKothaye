import type { JourneyMode, StopEta } from '@buskothay/shared';
import { en } from '../../content/en.js';
import { arrivalAt, formatDistance } from '../../lib/format.js';
import { canShowArrival } from './liveness.js';
import { routeProgress, type StopProgress } from './stop-progress.js';
import './stop-timeline.css';

const STATUS_TEXT: Record<StopProgress, string> = {
  passed: en.find.statusPassed,
  at: en.find.statusAt,
  approaching: en.find.statusApproaching,
  ahead: en.find.statusAhead,
  unknown: en.find.statusUnknown,
};

const STATUS_GLYPH: Record<StopProgress, string> = {
  passed: '✓',
  at: '●',
  approaching: '▲',
  ahead: '',
  unknown: '',
};

/**
 * The route as a list, with the bus's progress along it.
 *
 * This is the textual equivalent of the map, and it is what keeps the page
 * usable when the map cannot draw — so every row states its condition in words
 * as well as in colour, and the arrival is the same clock time the headline
 * shows. Choosing a row chooses that stop, which is the only interaction: a
 * timeline that could be reordered or collapsed would be a second, competing
 * source of truth about the route.
 */
export function StopTimeline({
  stops,
  mode,
  selectedStopId,
  onSelect,
  nowMs,
}: {
  stops: readonly StopEta[];
  mode: JourneyMode | null;
  selectedStopId: string | null;
  onSelect: (stopId: string) => void;
  nowMs: number;
}) {
  const progress = routeProgress(stops, mode);
  const showArrival = canShowArrival(mode);

  return (
    <ol className="stop-timeline" aria-label={en.sheet.stopsHeading}>
      {progress.rows.map((row) => {
        const isSelected = row.stop.stopId === selectedStopId;
        const arrival = showArrival ? arrivalAt(row.stop.etaSeconds, nowMs) : null;
        const distance = formatDistance(row.stop.distanceM);
        return (
          <li key={row.stop.stopId}>
            <button
              type="button"
              className={`timeline-row is-${row.progress}${isSelected ? ' is-selected' : ''}`}
              aria-pressed={isSelected}
              aria-current={row.progress === 'at' ? 'location' : undefined}
              onClick={() => onSelect(row.stop.stopId)}
            >
              <span className="timeline-row__blob" aria-hidden="true">
                {STATUS_GLYPH[row.progress]}
                {row.progress === 'at' ? <span className="timeline-row__pulse" /> : null}
              </span>
              <span className="timeline-row__body">
                <span className="timeline-row__name">
                  {row.stop.name}
                  {isSelected ? (
                    <span className="timeline-row__tag">{en.find.yourStop}</span>
                  ) : null}
                </span>
                <span className="timeline-row__sub">
                  <span className={`timeline-row__status is-${row.progress}`}>
                    {STATUS_TEXT[row.progress]}
                  </span>
                  {distance === null || row.progress === 'passed' ? null : (
                    <span>{distance}</span>
                  )}
                  <span>{en.find.stopPosition(row.index + 1, progress.rows.length)}</span>
                </span>
              </span>
              <span className="timeline-row__eta">{etaCell(row.progress, arrival)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function etaCell(
  progress: StopProgress,
  arrival: ReturnType<typeof arrivalAt>,
): React.ReactNode {
  if (progress === 'passed') return <small>{en.find.passedShort}</small>;
  if (progress === 'at') {
    return (
      <>
        {en.find.now}
        <small>{en.find.atStopShort}</small>
      </>
    );
  }
  if (arrival === null) {
    return (
      <>
        --:--
        <small>{en.find.noEstimate}</small>
      </>
    );
  }
  return (
    <>
      {arrival.clock}
      <small>~{arrival.minutes} {en.arrival.unit}</small>
    </>
  );
}
