import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CONTRIBUTOR_FLUSH_MS,
  CONTRIBUTOR_QUEUE_MAX,
  MAX_BATCH_REPORTS,
  type LocationReport,
  type ReportDecision,
} from '@buskothay/shared';
import { ApiError, NetworkError, api } from '../../lib/api.js';
import { advanceSeq, type ContributorSession } from '../../lib/session.js';

/**
 * Sharing this phone's location with a journey.
 *
 * Several things here are deliberate and easy to get wrong:
 *
 * - Sharing starts only when a person presses the button. Opening `/drive` never
 *   asks for location.
 * - Each fix records a *monotonic* receipt time, so `sampleAgeMs` describes how
 *   old the sample really is when it is finally sent, rather than being computed
 *   from a wall clock that may be wrong.
 * - Stopping clears the watcher, the queue, the timer and the wake lock, and a
 *   reply that arrives after stopping is ignored. A late retry must never resume
 *   uploading.
 * - A phone that is locked produces no fixes at all. The queue cannot contain
 *   positions that were never recorded, and nothing here pretends otherwise.
 */

export type SharingStatus = 'idle' | 'requesting' | 'sharing' | 'paused' | 'error';

export interface SharingState {
  readonly status: SharingStatus;
  readonly queuedCount: number;
  readonly lastDecision: ReportDecision | null;
  readonly lastSentAtMs: number | null;
  readonly errorCode: 'denied' | 'unavailable' | 'network' | null;
  readonly wakeLockDenied: boolean;
}

interface QueuedFix {
  readonly report: Omit<LocationReport, 'sampleAgeMs'>;
  /** `performance.now()` when the fix was captured. */
  readonly capturedAtMonotonicMs: number;
}

export function useGeoSharing(session: ContributorSession | null, onSession: (s: ContributorSession) => void) {
  const [state, setState] = useState<SharingState>({
    status: 'idle',
    queuedCount: 0,
    lastDecision: null,
    lastSentAtMs: null,
    errorCode: null,
    wakeLockDenied: false,
  });

  const watchId = useRef<number | null>(null);
  const flushTimer = useRef<number | undefined>(undefined);
  const queue = useRef<QueuedFix[]>([]);
  const nextSeq = useRef(session?.nextSeq ?? 0);
  const sessionRef = useRef(session);
  const activeRef = useRef(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const retryAfterUntilMs = useRef(0);

  sessionRef.current = session;
  if (session !== null && nextSeq.current < session.nextSeq) nextSeq.current = session.nextSeq;

  const releaseWakeLock = useCallback(() => {
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) {
      setState((s) => ({ ...s, wakeLockDenied: true }));
      return;
    }
    try {
      wakeLock.current = await navigator.wakeLock.request('screen');
      setState((s) => ({ ...s, wakeLockDenied: false }));
    } catch {
      // Denied or unsupported: sharing still works, the person is just told the
      // screen may sleep.
      setState((s) => ({ ...s, wakeLockDenied: true }));
    }
  }, []);

  const stopWatching = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    window.clearInterval(flushTimer.current);
    flushTimer.current = undefined;
    releaseWakeLock();
  }, [releaseWakeLock]);

  const flush = useCallback(async () => {
    const current = sessionRef.current;
    if (!activeRef.current || current === null) return;
    if (queue.current.length === 0) return;
    if (Date.now() < retryAfterUntilMs.current) return;

    const now = performance.now();
    // Oldest first inside the batch. The server takes only the newest fresh
    // report for live state and keeps the rest as history, so a backlog cannot
    // drag the bus back down the route.
    const batch = queue.current.slice(0, MAX_BATCH_REPORTS).map(
      (fix): LocationReport => ({
        ...fix.report,
        sampleAgeMs: Math.max(0, Math.round(now - fix.capturedAtMonotonicMs)),
      }),
    );

    try {
      const response = await api.sendLocations(current.journeyId, current.token, batch);
      if (!activeRef.current) return;
      // Only remove what was actually acknowledged.
      queue.current = queue.current.slice(batch.length);
      const highestSeq = Math.max(...batch.map((r) => r.seq));
      onSession(advanceSeq(current, highestSeq));
      setState((s) => ({
        ...s,
        queuedCount: queue.current.length,
        lastDecision: response.results.at(-1) ?? null,
        lastSentAtMs: Date.now(),
        errorCode: null,
      }));
    } catch (error) {
      if (!activeRef.current) return;
      if (error instanceof ApiError && error.status === 429) {
        retryAfterUntilMs.current = Date.now() + (error.retryAfterSeconds ?? 2) * 1000;
        return;
      }
      if (error instanceof ApiError && (error.status === 401 || error.status === 410)) {
        // The capability is gone or the journey has ended. Keeping the queue
        // would only produce repeated failures.
        queue.current = [];
        activeRef.current = false;
        stopWatching();
        setState((s) => ({ ...s, status: 'idle', queuedCount: 0, errorCode: null }));
        return;
      }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        // A rejected report is an answer, not a transport failure: do not retry
        // the same body forever.
        queue.current = queue.current.slice(batch.length);
        setState((s) => ({ ...s, queuedCount: queue.current.length }));
        return;
      }
      // Transient: keep the unsent reports and try again on the next tick.
      setState((s) => ({ ...s, errorCode: 'network', queuedCount: queue.current.length }));
    }
  }, [onSession, stopWatching]);

  const start = useCallback(() => {
    if (sessionRef.current === null) return;
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, status: 'error', errorCode: 'unavailable' }));
      return;
    }

    activeRef.current = true;
    setState((s) => ({ ...s, status: 'requesting', errorCode: null }));

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        if (!activeRef.current) return;
        const seq = nextSeq.current;
        nextSeq.current = seq + 1;
        queue.current.push({
          capturedAtMonotonicMs: performance.now(),
          report: {
            seq,
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            // Browsers may report no accuracy or an implausible one; the server's
            // floor and rejection threshold handle both.
            accuracyM: Number.isFinite(position.coords.accuracy) && position.coords.accuracy > 0
              ? position.coords.accuracy
              : 50,
            deviceTs: position.timestamp,
            ...(typeof position.coords.speed === 'number' && position.coords.speed >= 0
              ? { speedMps: position.coords.speed }
              : {}),
            ...(typeof position.coords.heading === 'number' &&
            position.coords.heading >= 0 &&
            position.coords.heading < 360
              ? { headingDeg: position.coords.heading }
              : {}),
          },
        });
        if (queue.current.length > CONTRIBUTOR_QUEUE_MAX) {
          queue.current = queue.current.slice(-CONTRIBUTOR_QUEUE_MAX);
        }
        setState((s) => ({
          ...s,
          status: 'sharing',
          queuedCount: queue.current.length,
          errorCode: null,
        }));
      },
      (error) => {
        if (!activeRef.current) return;
        setState((s) => ({
          ...s,
          status: 'error',
          errorCode: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable',
        }));
        if (error.code === error.PERMISSION_DENIED) {
          // Do not keep a watcher alive that will only re-prompt.
          activeRef.current = false;
          stopWatching();
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );

    flushTimer.current = window.setInterval(() => void flush(), CONTRIBUTOR_FLUSH_MS);
    void acquireWakeLock();
  }, [acquireWakeLock, flush, stopWatching]);

  /** Pause GPS without giving up control of the journey. */
  const pause = useCallback(() => {
    activeRef.current = false;
    stopWatching();
    setState((s) => ({ ...s, status: 'paused' }));
  }, [stopWatching]);

  /** Stop sharing entirely and discard anything not yet sent. */
  const stop = useCallback(
    async (revoke: boolean) => {
      activeRef.current = false;
      stopWatching();
      queue.current = [];
      setState((s) => ({ ...s, status: 'idle', queuedCount: 0, lastDecision: null }));
      const current = sessionRef.current;
      if (revoke && current !== null) {
        try {
          await api.revokeSelf(current.journeyId, current.token);
        } catch (error) {
          if (!(error instanceof NetworkError) && !(error instanceof ApiError)) throw error;
          // Best effort: the capability expires with the journey anyway.
        }
      }
    },
    [stopWatching],
  );

  // Reacquire the screen lock when the tab comes back, and flush what is queued.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && activeRef.current) {
        void acquireWakeLock();
        void flush();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [acquireWakeLock, flush]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      stopWatching();
    };
  }, [stopWatching]);

  return { state, start, pause, stop };
}
