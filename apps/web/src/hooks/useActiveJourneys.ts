import { useEffect, useState } from 'react';
import type { JourneySummary } from '@buskothay/shared';
import { api } from '../lib/api.js';

/**
 * The journeys currently running on a route.
 *
 * Polled slowly — journeys start and end on a human timescale, unlike positions.
 * The selection rule is deliberately written down rather than left implicit: a
 * journey with real contributors is preferred over a demonstration, and the demo
 * is still listed and still labelled. Nothing is hidden to make the map look busy.
 */
const LIST_POLL_MS = 5000;

export function useActiveJourneys(routeId: string): {
  journeys: readonly JourneySummary[];
  isLoading: boolean;
} {
  const [journeys, setJourneys] = useState<readonly JourneySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') {
        timer = window.setTimeout(poll, LIST_POLL_MS * 3);
        return;
      }
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await api.listJourneys(routeId, controller.signal);
        if (!cancelled) {
          setJourneys(response.journeys);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) setIsLoading(false);
      }
      if (!cancelled) timer = window.setTimeout(poll, LIST_POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [routeId]);

  return { journeys, isLoading };
}

/**
 * Which journey to show first.
 *
 * Real journeys before demonstrations, then the most recently started. Written as
 * one function so the rule can be read, tested and changed in one place.
 */
export function preferredJourney(journeys: readonly JourneySummary[]): JourneySummary | null {
  if (journeys.length === 0) return null;
  const ranked = [...journeys].sort((a, b) => {
    if (a.isDemo !== b.isDemo) return a.isDemo ? 1 : -1;
    return b.startedAtMs - a.startedAtMs;
  });
  return ranked[0] ?? null;
}
