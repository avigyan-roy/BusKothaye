import { useEffect, useState } from 'react';
import type { ArrivalsResponse } from '@buskothay/shared';
import { api, ApiError } from '../lib/api.js';

/**
 * Live arrivals for a stop, polled.
 *
 * Fifteen seconds rather than the map screen's one: a departure board is read
 * once and glanced at, and the clock times on it move a minute at a time. The
 * poll is skipped entirely while the tab is hidden, and one request is in flight
 * at a time, so a slow network produces a queue of one rather than a pile-up.
 */
const POLL_MS = 15_000;

export interface UseArrivals {
  readonly data: ArrivalsResponse | null;
  readonly isLoading: boolean;
  /** An API error code — 'STOP_NOT_FOUND' and friends — or a network failure. */
  readonly error: string | null;
}

export function useArrivals(
  from: string | null,
  options: { to?: string | null; routeId?: string | null } = {},
): UseArrivals {
  const to = options.to ?? null;
  const routeId = options.routeId ?? null;
  const [data, setData] = useState<ArrivalsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(from !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (from === null) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let inFlight: AbortController | null = null;
    setIsLoading(true);
    setData(null);
    setError(null);

    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(poll, POLL_MS);
        return;
      }
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      try {
        const response = await api.listArrivals({ from, to, routeId }, controller.signal);
        if (cancelled) return;
        setData(response);
        setError(null);
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return;
        // A 404 is a settled answer about the stop, not a blip: stop polling and
        // let the screen say so, rather than retrying a question with no answer.
        setError(caught instanceof ApiError ? caught.code : 'network');
        if (caught instanceof ApiError && caught.status === 404) {
          setIsLoading(false);
          return;
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(timer);
      void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [from, to, routeId]);

  return { data, isLoading, error };
}
