/**
 * Token-bucket rate limiting.
 *
 * Deliberately in-process. With the documented demo capacity of one instance this
 * is an accurate limit; at higher capacity each instance would enforce its own
 * share, which is a real limitation and is stated in the deployment guide rather
 * than papered over. It exists to stop accidental floods and to make a public demo
 * endpoint survivable, not to defeat a determined attacker.
 */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  take(key: string, cost = 1): RateLimitDecision {
    const now = this.nowMs();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefillMs: now };

    const elapsedS = Math.max(0, (now - bucket.lastRefillMs) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedS * this.refillPerSecond);
    bucket.lastRefillMs = now;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.buckets.set(key, bucket);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    this.buckets.set(key, bucket);
    const deficit = cost - bucket.tokens;
    return {
      allowed: false,
      retryAfterSeconds: this.refillPerSecond > 0 ? deficit / this.refillPerSecond : 60,
    };
  }

  /** Drop idle buckets so a long-running process does not grow without bound. */
  prune(idleMs = 10 * 60 * 1000): void {
    const cutoff = this.nowMs() - idleMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefillMs < cutoff) this.buckets.delete(key);
    }
  }
}
