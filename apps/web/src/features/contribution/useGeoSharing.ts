import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CONTRIBUTOR_FLUSH_MS,
  CONTRIBUTOR_QUEUE_MAX,
  MAX_BATCH_REPORTS,
  type LocationReport,
  type ReportDecision,
} from '@buskothay/shared';
import { ApiError, NetworkError, api } from '../../lib/api.js';
import { reserveSeq, type ContributorSession } from '../../lib/session.js';

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
  const sessionRef = useRef(session);
  const activeRef = useRef(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const retryAfterUntilMs = useRef(0);

  sessionRef.current = session;

  const releaseWakeLock = useCallback(() => {
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, []);

  const acquireWakeLock = useCallback(async (expectedGeneration = generation.current) => {
    if (!('wakeLock' in navigator)) {
      setState((s) => ({ ...s, wakeLockDenied: true }));
      return;
    }
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (!activeRef.current || expectedGeneration !== generation.current) {
        await acquired.release().catch(() => {});
        return;
      }
      await wakeLock.current?.release().catch(() => {});
      wakeLock.current = acquired;
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
    if (inFlight.current) return;
    if (queue.current.length === 0) return;
    if (Date.now() < retryAfterUntilMs.current) return;

    const expectedGeneration = generation.current;
    const now = performance.now();
    // Include the newest fix in every upload so a backlog cannot delay the live
    // bus marker. Fill the remaining positions with the oldest history and send
    // in sequence order so the server can retain a coherent audit trail.
    const selected = selectUploadBatch(queue.current, MAX_BATCH_REPORTS);
    const selectedSeqs = new Set(selected.map((fix) => fix.report.seq));
    const batch = selected.map(
      (fix): LocationReport => ({
        ...fix.report,
        sampleAgeMs: Math.max(0, Math.round(now - fix.capturedAtMonotonicMs)),
      }),
    );

    inFlight.current = true;
    try {
      const response = await api.sendLocations(current.journeyId, current.token, batch);
      if (!activeRef.current || expectedGeneration !== generation.current) return;
      // Only remove what was actually acknowledged.
      queue.current = queue.current.filter((fix) => !selectedSeqs.has(fix.report.seq));
      setState((s) => ({
        ...s,
        queuedCount: queue.current.length,
        lastDecision: response.results.at(-1) ?? null,
        lastSentAtMs: Date.now(),
        errorCode: null,
      }));
    } catch (error) {
      if (!activeRef.current || expectedGeneration !== generation.current) return;
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
        queue.current = queue.current.filter((fix) => !selectedSeqs.has(fix.report.seq));
        setState((s) => ({ ...s, queuedCount: queue.current.length }));
        return;
      }
      // Transient: keep the unsent reports and try again on the next tick.
      setState((s) => ({ ...s, errorCode: 'network', queuedCount: queue.current.length }));
    } finally {
      inFlight.current = false;
    }
  }, [stopWatching]);

  const start = useCallback(() => {
    if (sessionRef.current === null) return;
    if (activeRef.current || watchId.current !== null) return;
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, status: 'error', errorCode: 'unavailable' }));
      return;
    }

    activeRef.current = true;
    generation.current += 1;
    const expectedGeneration = generation.current;
    setState((s) => ({ ...s, status: 'requesting', errorCode: null }));

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        if (!activeRef.current) return;
        const current = sessionRef.current;
        if (current === null) return;
        const reservation = reserveSeq(current);
        sessionRef.current = reservation.session;
        onSession(reservation.session);
        queue.current.push({
          capturedAtMonotonicMs: performance.now(),
          report: {
            seq: reservation.firstSeq,
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
    void acquireWakeLock(expectedGeneration);
  }, [acquireWakeLock, flush, onSession, stopWatching]);

  /** Pause GPS without giving up control of the journey. */
  const pause = useCallback(() => {
    activeRef.current = false;
    generation.current += 1;
    stopWatching();
    setState((s) => ({ ...s, status: 'paused' }));
  }, [stopWatching]);

  /** Stop sharing entirely and discard anything not yet sent. */
  const stop = useCallback(
    async (revoke: boolean) => {
      activeRef.current = false;
      generation.current += 1;
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
        void acquireWakeLock(generation.current);
        void flush();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [acquireWakeLock, flush]);

  useEffect(() => {
    generation.current += 1;
    activeRef.current = false;
    stopWatching();
    queue.current = [];
    inFlight.current = false;
    setState((current) => ({
      ...current,
      status: 'idle',
      queuedCount: 0,
      lastDecision: null,
      errorCode: null,
    }));
  }, [session?.journeyId, session?.contributorId, stopWatching]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      generation.current += 1;
      stopWatching();
    };
  }, [stopWatching]);

  return { state, start, pause, stop };
}

/** Pure for unit tests and intentionally exported: queue priority is safety logic. */
export function selectUploadBatch<T extends QueuedFix>(
  fixes: readonly T[],
  maximum: number,
): readonly T[] {
  if (maximum <= 0 || fixes.length === 0) return [];
  if (fixes.length <= maximum) return [...fixes].sort((a, b) => a.report.seq - b.report.seq);
  if (maximum === 1) return [fixes[fixes.length - 1]!];
  const newest = fixes[fixes.length - 1]!;
  return [...fixes.slice(0, maximum - 1), newest].sort(
    (a, b) => a.report.seq - b.report.seq,
  );
}
