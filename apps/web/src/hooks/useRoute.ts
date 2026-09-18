import { useEffect, useState } from 'react';
import { prepareFromDto, type PreparedRoute } from '@buskothay/shared';
import { api } from '../lib/api.js';
import { ApiError } from '../lib/api.js';

/**
 * Loads the route once and prepares its polyline.
 *
 * The prepared polyline is what lets the browser turn a distance along the route
 * back into a coordinate, so the marker sits on the road rather than on a
 * straight line between two fixes. The route definition itself comes from the
 * server — the browser never keeps a second copy of the geometry.
 */
export interface UseRouteResult {
  readonly route: PreparedRoute | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
}

export function useRoute(routeId: string): UseRouteResult {
  const [route, setRoute] = useState<PreparedRoute | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    api
      .getRoute(routeId, controller.signal)
      .then((dto) => {
        if (cancelled) return;
        setRoute(prepareFromDto(dto));
        setIsLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.code : 'route-unavailable');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [routeId, attempt]);

  return { route, isLoading, error, reload: () => setAttempt((a) => a + 1) };
}
