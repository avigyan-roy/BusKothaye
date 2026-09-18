import { useEffect, useState } from 'react';
import type { RouteSummary } from '@buskothay/shared';
import { api } from '../lib/api.js';

export function useRoutes() {
  const [routes, setRoutes] = useState<readonly RouteSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    api.listRoutes(controller.signal).then(
      (response) => {
        setRoutes(response.routes);
        setError(null);
        setIsLoading(false);
      },
      () => {
        if (!controller.signal.aborted) {
          setError('route-list-unavailable');
          setIsLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, []);

  return { routes, isLoading, error };
}

