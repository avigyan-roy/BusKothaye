/**
 * Display formatting.
 *
 * Rounding happens here, at the edge, so that the numbers the engine works with
 * stay exact. Nothing in this file invents a value: a null stays a null and the
 * caller decides what to say instead.
 */

/**
 * The arrival, as a clock time.
 *
 * A passenger standing at a stop compares what the screen says with the clock on
 * their own phone, so the answer is a time of day — one time, in 24-hour form,
 * matching every printed timetable and station board in the country. "15–20
 * minutes" is the same information in a shape nobody can act on: it cannot be
 * compared with anything, and two people reading it disagree about when to look
 * up. The spread has not been hidden — it is why `minutes` is offered beside the
 * clock as a rough "how long", and why a stale journey is labelled rather than
 * given a more precise-looking number.
 *
 * `fromMs` is the device clock on purpose. The number has to agree with the
 * watch the person is wearing, not with the server's idea of now.
 */
export interface Arrival {
  /** "18:53" — 24-hour, zero-padded, always exactly five characters. */
  readonly clock: string;
  /** Whole minutes from now, at least 1. Secondary to the clock, never instead. */
  readonly minutes: number;
  readonly atMs: number;
}

export function arrivalAt(
  etaSeconds: number | null | undefined,
  fromMs: number = Date.now(),
): Arrival | null {
  if (etaSeconds === null || etaSeconds === undefined || !Number.isFinite(etaSeconds)) {
    return null;
  }
  const seconds = Math.max(0, etaSeconds);
  const atMs = fromMs + seconds * 1000;
  return {
    clock: formatClock(atMs),
    minutes: Math.max(1, Math.round(seconds / 60)),
    atMs,
  };
}

/** 24-hour wall-clock time for an instant, in the device's own timezone. */
export function formatClock(atMs: number): string {
  const at = new Date(atMs);
  if (Number.isNaN(at.getTime())) return '--:--';
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** Short, human elapsed time: "8 sec", "2 min", "1 hr 5 min". */
export function formatElapsed(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} sec`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ${minutes % 60} min`;
}

/** "450 m" under a kilometre, "3.2 km" above it. */
export function formatDistance(metres: number | null): string | null {
  if (metres === null || !Number.isFinite(metres)) return null;
  const abs = Math.abs(metres);
  if (abs < 1000) return `${Math.round(abs / 10) * 10} m`;
  return `${(abs / 1000).toFixed(1)} km`;
}

export function formatSpeed(kmh: number | null): string | null {
  if (kmh === null || !Number.isFinite(kmh)) return null;
  return `${Math.round(kmh)} km/h`;
}

/** Whole metres for the published accuracy; decimals would imply precision. */
export function formatAccuracy(metres: number | null): number | null {
  if (metres === null || !Number.isFinite(metres)) return null;
  return Math.max(1, Math.round(metres));
}
