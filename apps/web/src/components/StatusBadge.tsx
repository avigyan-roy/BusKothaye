import type { JourneyMode } from '@buskothay/shared';
import { en } from '../content/en.js';
import './status-badge.css';

/**
 * Tracking status: a shape, a word and a colour — never a colour on its own.
 *
 * Each mode has its own glyph shape as well as its own hue, so the state is
 * still readable in monochrome, at a glance, or by someone who cannot separate
 * amber from green.
 */

const LABEL: Record<JourneyMode, string> = {
  PENDING: en.freshness.pending,
  LIVE: en.freshness.live,
  DWELLING: en.freshness.dwelling,
  ESTIMATED: en.freshness.estimated,
  STALE: en.freshness.stale,
  ENDED: en.freshness.ended,
};

const GLYPH: Record<JourneyMode, string> = {
  LIVE: 'solid',
  DWELLING: 'square',
  ESTIMATED: 'hollow',
  STALE: 'stale',
  ENDED: 'ended',
  PENDING: 'pending',
};

export function StatusBadge({
  mode,
  detail,
  compact = false,
}: {
  mode: JourneyMode;
  detail?: string | null;
  compact?: boolean;
}) {
  return (
    <span
      className={`status-badge status-badge--${mode.toLowerCase()}${
        compact ? ' status-badge--compact' : ''
      }`}
    >
      <span
        className={`status-badge__glyph status-badge__glyph--${GLYPH[mode]}`}
        aria-hidden="true"
      />
      <span className="status-badge__label">{LABEL[mode]}</span>
      {detail ? <span className="status-badge__detail">{detail}</span> : null}
    </span>
  );
}
