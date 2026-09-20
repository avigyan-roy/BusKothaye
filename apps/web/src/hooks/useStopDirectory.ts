import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DirectoryStop } from '@buskothay/shared';
import { api } from '../lib/api.js';
import { loadStopKey, saveStopKey } from '../lib/stop-preference.js';

/**
 * Every stop the system can answer for, and which one is "mine".
 *
 * The directory comes from the server so that an administrator publishing a
 * route immediately adds its stops here, with nothing to change in the browser.
 * The selection lives beside it because the two are only meaningful together: a
 * remembered stop that no longer exists is not a selection, and this hook is the
 * one place that resolves it rather than leaving each screen to notice.
 */
export interface UseStopDirectory {
  readonly stops: readonly DirectoryStop[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly selected: DirectoryStop | null;
  readonly select: (key: string) => void;
  /** Nearest-stop detection. Resolves to null when it could not be determined. */
  readonly locate: () => void;
  readonly locating: 'idle' | 'locating' | 'unavailable';
  readonly reload: () => void;
}

export function useStopDirectory(): UseStopDirectory {
  const [stops, setStops] = useState<readonly DirectoryStop[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => loadStopKey());
  const [locating, setLocating] = useState<'idle' | 'locating' | 'unavailable'>('idle');

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    api.listStops(controller.signal).then(
      (response) => {
        setStops(response.stops);
        setError(null);
        setIsLoading(false);
      },
      () => {
        if (controller.signal.aborted) return;
        setError('stop-directory-unavailable');
        setIsLoading(false);
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const select = useCallback((key: string) => {
    setSelectedKey(key);
    saveStopKey(key);
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation || stops.length === 0) {
      setLocating('unavailable');
      return;
    }
    setLocating('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nearest = nearestStop(stops, position.coords.latitude, position.coords.longitude);
        setLocating('idle');
        if (nearest !== null) select(nearest.key);
      },
      // A refusal is an answer, not a failure: the person picks a stop instead.
      () => setLocating('unavailable'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [select, stops]);

  const selected = useMemo(
    () => stops.find((stop) => stop.key === selectedKey) ?? null,
    [stops, selectedKey],
  );

  return {
    stops,
    isLoading,
    error,
    selected,
    select,
    locate,
    locating,
    reload: () => setAttempt((value) => value + 1),
  };
}

/**
 * Nearest by equirectangular approximation.
 *
 * Over a city this is within a metre or two of the great-circle distance, and it
 * is only ever used to rank candidates — the winner is the same either way.
 */
export function nearestStop(
  stops: readonly DirectoryStop[],
  lat: number,
  lon: number,
): DirectoryStop | null {
  let best: DirectoryStop | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const stop of stops) {
    const dLat = stop.lat - lat;
    const dLon = (stop.lon - lon) * Math.cos((lat * Math.PI) / 180);
    const score = dLat * dLat + dLon * dLon;
    if (score < bestScore) {
      bestScore = score;
      best = stop;
    }
  }
  return best;
}
