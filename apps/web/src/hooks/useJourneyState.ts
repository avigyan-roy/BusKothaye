import { useEffect, useRef, useState } from 'react';
import { PASSENGER_POLL_MS, type JourneyStateDto } from '@buskothay/shared';
import { ApiError, NetworkError, api } from '../lib/api.js';

/**
 * Polls one journey's state at about one second.
 *
 * Three things here matter more than the polling itself:
 *
 * 1. One request is in flight at a time, with an abort controller and a timeout,
 *    so a slow network produces a queue of one rather than a pile-up.
 * 2. `serverTs` is captured alongside a *monotonic* receipt time. The device wall
 *    clock is never subtracted from the server's, because a phone two hours out
 *    would otherwise show a bus that is two hours stale.
 * 3. A response older than the state we already hold is discarded.
 */

export interface JourneyStateSnapshot {
  readonly state: JourneyStateDto;
  /** `performance.now()` at the moment the response arrived. */
  readonly receivedAtMonotonicMs: number;
}

export interface UseJourneyStateResult {
  readonly snapshot: JourneyStateSnapshot | null;
  readonly isLoading: boolean;
  /** Set when polls are failing. The journey mode still degrades on its own. */
  readonly isReconnecting: boolean;
  readonly error: string | null;
}

export function useJourneyState(journeyId: string | null): UseJourneyStateResult {
  const [snapshot, setSnapshot] = useState<JourneyStateSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(journeyId !== null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latestVersion = useRef(-1);
  const latestServerTs = useRef(-1);

  useEffect(() => {
    if (journeyId === null) {
      setSnapshot(null);
      setIsLoading(false);
      setIsReconnecting(false);
      setError(null);
      return;
    }

    latestVersion.current = -1;
    latestServerTs.current = -1;
    setIsLoading(true);
    setSnapshot(null);
    setIsReconnecting(false);
    setError(null);

    let cancelled = false;
    let inFlight: AbortController | null = null;
    let timer: number | undefined;
    let consecutiveFailures = 0;

    const scheduleNext = (delayMs: number) => {
      if (cancelled) return;
      timer = window.setTimeout(poll, delayMs);
    };

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') {
        // Nothing is on screen to update; wait for the visibility change instead
        // of burning the phone's battery and the person's data.
        scheduleNext(PASSENGER_POLL_MS * 4);
        return;
      }

      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;

      try {
        const state = await api.getState(journeyId, controller.signal);
        if (cancelled) return;

        const isNewer =
          state.stateVersion > latestVersion.current ||
          (state.stateVersion === latestVersion.current && state.serverTs > latestServerTs.current);
        if (isNewer) {
          latestVersion.current = state.stateVersion;
          latestServerTs.current = state.serverTs;
          setSnapshot({ state, receivedAtMonotonicMs: performance.now() });
        }
        consecutiveFailures = 0;
        setIsReconnecting(false);
        setError(null);
        setIsLoading(false);
        scheduleNext(PASSENGER_POLL_MS);
      } catch (caught) {
        if (cancelled) return;
        setIsLoading(false);
        consecutiveFailures += 1;

        if (caught instanceof ApiError && caught.status === 404) {
          setError('journey-not-found');
          return;
        }
        if (caught instanceof ApiError && caught.status === 429) {
          scheduleNext((caught.retryAfterSeconds ?? 2) * 1000);
          return;
        }
        if (caught instanceof NetworkError || caught instanceof ApiError) {
          // Two misses is a blip; after that the person is told the app is
          // reconnecting — while the journey mode keeps degrading on its own,
          // because the position really is getting older.
          if (consecutiveFailures >= 2) setIsReconnecting(true);
          const backoffMs = Math.min(8000, PASSENGER_POLL_MS * 2 ** (consecutiveFailures - 1));
          scheduleNext(backoffMs);
          return;
        }
        setError('unknown');
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [journeyId]);

  return { snapshot, isLoading, isReconnecting, error };
}
