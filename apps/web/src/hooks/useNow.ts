import { useEffect, useState } from 'react';

/**
 * The device clock, re-read every so often.
 *
 * Arrival times are rendered as "now plus the remaining seconds", so the clock
 * they are built on has to move. Ten seconds is frequent enough that a displayed
 * minute is never more than a few seconds out of date and rare enough to cost
 * nothing; the arrival itself is recomputed whenever fresh data arrives too.
 */
export function useNow(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
