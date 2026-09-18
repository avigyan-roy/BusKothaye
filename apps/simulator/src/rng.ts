/**
 * Seeded randomness.
 *
 * Every scenario records its seed with its results. A run nobody can reproduce is
 * not evidence, and "it passed once" is not a measurement.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Normal deviate with the given mean and standard deviation. */
  normal(mean: number, sd: number): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
}

/** mulberry32 — small, fast, and good enough for measurement noise. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    normal(mean, sd) {
      // Box–Muller. The second deviate is discarded; simplicity beats saving one
      // call here.
      const u1 = Math.max(Number.MIN_VALUE, next());
      const u2 = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    range: (min, max) => min + next() * (max - min),
    chance: (probability) => next() < probability,
  };
}
