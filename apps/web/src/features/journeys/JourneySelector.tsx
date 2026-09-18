import type { JourneySummary } from '@buskothay/shared';
import { en } from '../../content/en.js';

/**
 * Choosing between several live journeys.
 *
 * It is a plain labelled select, and every demo journey says so in its own
 * option text. A real journey is never preferred by quietly hiding a demo one —
 * the ordering is documented and the label is always visible.
 */
export function JourneySelector({
  journeys,
  selectedId,
  onSelect,
}: {
  journeys: readonly JourneySummary[];
  selectedId: string | null;
  onSelect: (journeyId: string) => void;
}) {
  if (journeys.length <= 1) return null;

  return (
    <div className="journey-selector panel">
      <label className="field">
        <span className="field__label">{en.journeys.selectJourney}</span>
        <select
          className="field__input"
          value={selectedId ?? ''}
          onChange={(event) => onSelect(event.target.value)}
        >
          {journeys.map((journey, index) => (
            <option key={journey.journeyId} value={journey.journeyId}>
              {`${index + 1}. ${journey.mode.toLowerCase()}`}
              {journey.isDemo ? ` · ${en.common.demoJourney}` : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
