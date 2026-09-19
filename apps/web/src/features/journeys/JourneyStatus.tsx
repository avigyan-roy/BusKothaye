import type { JourneyMode } from '@buskothay/shared';
import { StatusBadge } from '../../components/StatusBadge.js';
import { en } from '../../content/en.js';
import { formatElapsed } from '../../lib/format.js';
import './journey-status.css';

/**
 * The one status element over the map.
 *
 * It answers a single question — can I trust what I am looking at — and it is the
 * only place the tracking state is written, so the sheet below never repeats it.
 * A failing connection outranks the mode, because a person needs to know that the
 * screen has stopped being updated before they read anything else on it.
 */
export function JourneyStatus({
  mode,
  ageSeconds,
  hasJourney,
  isReconnecting,
}: {
  mode: JourneyMode;
  ageSeconds: number | null;
  hasJourney: boolean;
  isReconnecting: boolean;
}) {
  if (!hasJourney) {
    return (
      <p className="journey-status" role="status">
        <span className="journey-status__idle-glyph" aria-hidden="true" />
        <span className="journey-status__idle">{en.sheet.noBus}</span>
      </p>
    );
  }

  const age = formatElapsed(ageSeconds);
  return (
    <p className="journey-status" role="status">
      <StatusBadge
        mode={mode}
        compact
        detail={age === null ? null : en.sheet.updatedAgo(age)}
      />
      {isReconnecting ? (
        <span className="journey-status__reconnecting">{en.freshness.reconnecting}</span>
      ) : null}
    </p>
  );
}
