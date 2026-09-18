/**
 * Time handling shared by the server, the browser and the simulator.
 *
 * Two clocks exist and they are not interchangeable. Epoch milliseconds are for
 * serialisation and for anything a human reads. Elapsed time — durations,
 * freshness, projection — comes from a monotonic source, because a phone whose
 * wall clock is two hours out must not be able to move a bus or change how fresh
 * its own data looks.
 */

/** Injectable clock. The fusion engine never calls `Date.now()` itself. */
export interface Clock {
  /** Epoch milliseconds, for timestamps that leave the process. */
  nowMs(): number;
  /** Monotonic milliseconds since an arbitrary origin, for durations. */
  monotonicMs(): number;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  monotonicMs: () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now(),
};

/** A clock the tests drive by hand. Both readings advance together. */
export function createFixedClock(startMs: number): Clock & {
  advance(ms: number): void;
  set(ms: number): void;
} {
  let nowMs = startMs;
  let monotonic = 0;
  return {
    nowMs: () => nowMs,
    monotonicMs: () => monotonic,
    advance(ms: number) {
      nowMs += ms;
      monotonic += ms;
    },
    set(ms: number) {
      // A wall-clock jump must not move monotonic time; that is the whole point.
      nowMs = ms;
    },
  };
}

/** Durations are never negative, whatever the clocks did. */
export function clampDurationMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * How old a report is, from the server's point of view.
 *
 * The server's own receive time is the reference. The client-reported sample age
 * is bounded and subtracted so that an ordinary buffered upload is aged
 * correctly; `deviceTs` is recorded for diagnostics and never used for this.
 */
export function reportAgeMs(
  serverReceivedAtMs: number,
  nowMs: number,
  sampleAgeMs: number,
  maxSampleAgeMs: number,
): number {
  const bounded = Math.min(clampDurationMs(sampleAgeMs), maxSampleAgeMs);
  return clampDurationMs(nowMs - serverReceivedAtMs) + bounded;
}

/** Whole seconds, rounded down, for display and for DTO age fields. */
export function toSeconds(ms: number): number {
  return Math.max(0, Math.floor(ms / 1000));
}

/** Epoch seconds, for the DynamoDB TTL attribute. */
export function toEpochSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}
