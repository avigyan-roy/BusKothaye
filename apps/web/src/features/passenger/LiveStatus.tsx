import type { JourneyMode } from '@buskothay/shared';
import { en } from '../../content/en.js';
import { formatElapsed } from '../../lib/format.js';
import { livenessOf } from './liveness.js';
import './live-status.css';

/**
 * "Live · updated 8 sec ago", or the honest alternative.
 *
 * The dot pulses only when the position is actually being refreshed. A pulsing
 * dot beside a twenty-minute-old position would be a lie told in animation, so
 * the stale and offline states get a still dot and different words.
 */
export function LiveStatus({
  mode,
  ageSeconds,
  className,
}: {
  mode: JourneyMode | null;
  ageSeconds: number | null;
  className?: string;
}) {
  const liveness = livenessOf(mode);
  const age = formatElapsed(ageSeconds);
  // Five modes, five different things to say. "Out of date" and "no bus at all"
  // are not the same situation and must not read as though they were.
  const label =
    liveness === 'live'
      ? en.freshness.live
      : liveness === 'stale'
        ? en.freshness.positionMayBeOld
        : mode === 'PENDING'
          ? en.journeys.waitingFirstFix
          : mode === 'ENDED'
            ? en.journeys.ended
            : mode === 'STALE'
              ? en.freshness.stale
              : en.sheet.noBus;

  return (
    <span className={`live-status is-${liveness}${className ? ` ${className}` : ''}`}>
      <span className="live-status__dot" aria-hidden="true" />
      <span className="live-status__label">{label}</span>
      {age === null || liveness === 'none' ? null : (
        <span className="live-status__age">{en.sheet.updatedAgo(age)}</span>
      )}
    </span>
  );
}
