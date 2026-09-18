import type { JourneyMode } from '@buskothay/shared';
import { en } from '../content/en.js';
import './status-badge.css';

/**
 * Tracking status: an icon, a word and a colour — never a colour on its own.
 * Green is also this interface's accent, so colour alone could not carry meaning
 * even if we wanted it to.
 */

const LABEL: Record<JourneyMode, string> = {
  PENDING: en.freshness.pending,
  LIVE: en.freshness.live,
  DWELLING: en.freshness.dwelling,
  ESTIMATED: en.freshness.estimated,
  STALE: en.freshness.stale,
  ENDED: en.freshness.ended,
};

function Glyph({ mode }: { mode: JourneyMode }) {
  // Solid for confirmed, hollow for estimated, faded for out of date.
  switch (mode) {
    case 'LIVE':
      return <span className="status-badge__glyph status-badge__glyph--solid" aria-hidden="true" />;
    case 'DWELLING':
      return <span className="status-badge__glyph status-badge__glyph--square" aria-hidden="true" />;
    case 'ESTIMATED':
      return <span className="status-badge__glyph status-badge__glyph--hollow" aria-hidden="true" />;
    case 'STALE':
      return <span className="status-badge__glyph status-badge__glyph--faded" aria-hidden="true" />;
    case 'ENDED':
      return <span className="status-badge__glyph status-badge__glyph--ended" aria-hidden="true" />;
    default:
      return <span className="status-badge__glyph status-badge__glyph--pending" aria-hidden="true" />;
  }
}

export function StatusBadge({ mode, detail }: { mode: JourneyMode; detail?: string | null }) {
  return (
    <span className={`status-badge status-badge--${mode.toLowerCase()}`}>
      <Glyph mode={mode} />
      <span className="status-badge__label">{LABEL[mode]}</span>
      {detail ? <span className="status-badge__detail"> · {detail}</span> : null}
    </span>
  );
}
