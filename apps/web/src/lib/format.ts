/**
 * Display formatting.
 *
 * Rounding happens here, at the edge, so that the numbers the engine works with
 * stay exact. Nothing in this file invents a value: a null stays a null and the
 * caller decides what to say instead.
 */

/** "6–9 min" for a range, "7 min" for a point, null when there is nothing to say. */
export function formatEtaRange(
  seconds: number | null,
  range: readonly [number, number] | null,
): string | null {
  if (range !== null) {
    const low = Math.max(1, Math.round(range[0] / 60));
    const high = Math.max(low, Math.round(range[1] / 60));
    return low === high ? `${low}` : `${low}–${high}`;
  }
  if (seconds === null) return null;
  return String(Math.max(1, Math.round(seconds / 60)));
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
