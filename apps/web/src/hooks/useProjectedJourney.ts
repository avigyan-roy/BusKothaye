import { useEffect, useRef, useState } from 'react';
import {
  modeAtTime,
  projectBounded,
  type JourneyMode,
  type JourneyStateDto,
  type ProjectionAnchor,
} from '@buskothay/shared';
import type { JourneyStateSnapshot } from './useJourneyState.js';

/**
 * The marker between polls.
 *
 * It advances using the *same* bounded projection the server used, fed with the
 * confirmed anchor the server sent — not with the last coordinate it drew. That
 * is what stops the dot walking down the route forever when the network drops:
 * the anchor carries its own cap and its own stale deadline, and this hook
 * honours both.
 *
 * Elapsed time comes from `performance.now()`, so the estimate is unaffected by a
 * phone whose clock is wrong.
 */

export interface ProjectedJourney {
  /** Distance along the route to draw at this instant, or null when unknown. */
  readonly sM: number | null;
  /** The mode a passenger should be shown right now, including local degradation. */
  readonly mode: JourneyMode;
  /** Seconds since the position was last confirmed by evidence. */
  readonly ageSeconds: number | null;
  readonly isFrozen: boolean;
}

/** Server time implied by a snapshot plus monotonic elapsed time since it arrived. */
export function impliedServerNowMs(snapshot: JourneyStateSnapshot, monotonicNowMs: number): number {
  return snapshot.state.serverTs + Math.max(0, monotonicNowMs - snapshot.receivedAtMonotonicMs);
}

export function projectSnapshot(
  snapshot: JourneyStateSnapshot,
  monotonicNowMs: number,
): ProjectedJourney {
  const state: JourneyStateDto = snapshot.state;
  const nowMs = impliedServerNowMs(snapshot, monotonicNowMs);
  const anchor: ProjectionAnchor | null = state.projection;

  if (anchor === null) {
    return {
      sM: state.position?.sM ?? null,
      mode: state.mode,
      ageSeconds: state.lastFixAgeSeconds,
      isFrozen: true,
    };
  }

  const projected = projectBounded(anchor, nowMs);
  const baseMode: JourneyMode = state.mode === 'DWELLING' ? 'DWELLING' : 'LIVE';
  const mode =
    state.mode === 'ENDED' || state.mode === 'PENDING'
      ? state.mode
      : modeAtTime(baseMode, anchor, nowMs);

  return {
    sM: projected.sM,
    mode,
    ageSeconds: projected.ageSeconds,
    isFrozen: projected.isFrozen,
  };
}

/**
 * Re-projects on an animation frame while the tab is visible.
 *
 * Only the numbers this hook returns change per frame; React state for the panel
 * is updated at the polling cadence, and the map marker is moved through the map
 * API rather than by re-rendering the tree.
 */
export function useProjectedJourney(
  snapshot: JourneyStateSnapshot | null,
  enabled = true,
): ProjectedJourney | null {
  const [projected, setProjected] = useState<ProjectedJourney | null>(null);
  const frame = useRef<number>(0);

  useEffect(() => {
    if (snapshot === null || !enabled) {
      setProjected(null);
      return;
    }

    let last = -1;
    const tick = () => {
      const now = performance.now();
      // Four updates a second is smooth enough for a bus and cheap enough for a
      // phone; a full animation-frame cadence here would buy nothing visible.
      if (now - last >= 250) {
        last = now;
        setProjected(projectSnapshot(snapshot, now));
      }
      frame.current = window.requestAnimationFrame(tick);
    };
    frame.current = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame.current);
  }, [snapshot, enabled]);

  return projected;
}
