import type { JourneyMode } from '@buskothay/shared';

/**
 * How much the screen may claim about where the bus is.
 *
 * Three states, because there are only three honest answers: we are being told
 * where it is, we were told a while ago, or nobody is telling us. Every screen
 * derives its wording, its colour and whether it shows an arrival time from
 * this one function, so a journey that has gone stale cannot look live on one
 * screen and stale on another.
 */
export type Liveness = 'live' | 'stale' | 'none';

export function livenessOf(mode: JourneyMode | null | undefined): Liveness {
  switch (mode) {
    case 'LIVE':
    case 'DWELLING':
      return 'live';
    case 'ESTIMATED':
      return 'stale';
    // PENDING has a journey but no position yet; STALE and ENDED had one and no
    // longer do. In all three there is nothing trustworthy to put on a map.
    case 'STALE':
    case 'ENDED':
    case 'PENDING':
    default:
      return 'none';
  }
}

/** True when an arrival time may be shown for this mode. */
export function canShowArrival(mode: JourneyMode | null | undefined): boolean {
  return livenessOf(mode) !== 'none';
}
