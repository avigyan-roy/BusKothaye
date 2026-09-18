import { interpolateAt, metresPerDegreeLatitude, metresPerDegreeLongitude } from '@buskothay/geometry';
import type { LocationReport, PreparedRoute } from '@buskothay/shared';
import type { Rng } from './rng.js';
import { isInWindow, truthSM, type Scenario, type SourceSpec } from './scenario.js';

/**
 * One simulated phone.
 *
 * It knows the truth, adds its own noise to it, and sends the result through the
 * ordinary API. Along-track and cross-track error are modelled separately because
 * they behave differently: cross-track error is what the corridor gate sees, while
 * along-track error is what the fusion actually has to resolve.
 */
export class SimulatedSource {
  private seq = 0;
  private buffered: { report: LocationReport; tS: number }[] = [];

  constructor(
    readonly spec: SourceSpec,
    private readonly scenario: Scenario,
    private readonly route: PreparedRoute,
    private readonly rng: Rng,
    private readonly startWallMs: number,
  ) {}

  /** The contributor capability, set once the source has created or joined. */
  token: string | null = null;
  /** Reports this source sent, and how the server answered, for the scorecard. */
  sent = 0;
  rejected = 0;

  get isDishonest(): boolean {
    return this.spec.spoof !== undefined;
  }

  /** Whether this source produces a fix at all at this moment. */
  isProducing(tS: number): boolean {
    if (tS < this.spec.activeFromS || tS >= this.spec.activeUntilS) return false;
    if (isInWindow(this.spec.outages, tS)) return false;
    return true;
  }

  /** Whether the source is holding its uploads back rather than sending them. */
  isPartitioned(tS: number): boolean {
    return isInWindow(this.spec.partitions, tS);
  }

  /** Build the fix this phone would record at time `tS`. */
  sample(tS: number): LocationReport {
    const trueSM = truthSM(this.scenario, tS);
    let reportedSM = trueSM;
    let crossM = this.rng.normal(0, this.spec.crossNoiseM);
    let accuracyM =
      this.spec.forceAccuracyM ??
      this.rng.range(this.spec.accuracyRangeM[0], this.spec.accuracyRangeM[1]);

    const spoof = this.spec.spoof;
    if (spoof?.kind === 'onroute') {
      // Wrong position, excellent claimed accuracy. This is the case that would
      // capture a weighted median if consensus did not come first.
      reportedSM = trueSM + spoof.offsetM;
      accuracyM = spoof.claimedAccuracyM;
      crossM = 0;
    } else if (spoof?.kind === 'jump' && tS >= spoof.fromS && tS < spoof.toS) {
      reportedSM = trueSM + spoof.offsetM;
      crossM = 0;
    }

    if (spoof?.kind === 'static') {
      // A fixed coordinate nowhere near the corridor.
      this.seq += 1;
      return {
        seq: this.seq,
        lat: spoof.lat,
        lon: spoof.lon,
        accuracyM,
        deviceTs: this.startWallMs + tS * 1000 + this.spec.clockSkewMs,
        sampleAgeMs: 0,
      };
    }

    reportedSM += this.rng.normal(0, this.spec.alongNoiseM);
    const clamped = Math.min(this.route.dto.lengthM, Math.max(0, reportedSM));
    const { lat, lon } = offsetFromRoute(this.route, clamped, crossM);

    this.seq += 1;
    return {
      seq: this.seq,
      lat,
      lon,
      accuracyM,
      // Advisory and deliberately skewed in some scenarios: the server must not
      // use it for timing.
      deviceTs: this.startWallMs + tS * 1000 + this.spec.clockSkewMs,
      sampleAgeMs: 0,
    };
  }

  buffer(report: LocationReport, tS: number): void {
    this.buffered.push({ report, tS });
    if (this.buffered.length > 200) this.buffered.shift();
  }

  /**
   * Take everything held back during a partition.
   *
   * Each buffered report carries the age it actually has by the time it is sent,
   * measured from the sample moment — that is what tells the server this is a
   * backlog and not a burst of fresh evidence.
   */
  drainBuffer(nowS: number): LocationReport[] {
    const out = this.buffered.map(({ report, tS }) => ({
      ...report,
      sampleAgeMs: Math.max(0, Math.round((nowS - tS) * 1000)),
    }));
    this.buffered = [];
    return out;
  }

  get bufferedCount(): number {
    return this.buffered.length;
  }
}

/**
 * A point `crossM` metres to the side of the route at distance `sM`.
 * The route tangent is taken from a one-metre step, which is accurate enough at
 * these scales and needs no extra geometry.
 */
export function offsetFromRoute(
  route: PreparedRoute,
  sM: number,
  crossM: number,
): { lat: number; lon: number } {
  const [lon, lat] = interpolateAt(route.line, sM);
  if (crossM === 0) return { lat, lon };

  const ahead = Math.min(route.dto.lengthM, sM + 1);
  const [lonB, latB] = interpolateAt(route.line, ahead);

  const mPerLat = metresPerDegreeLatitude(lat);
  const mPerLon = metresPerDegreeLongitude(lat);
  const dx = (lonB - lon) * mPerLon;
  const dy = (latB - lat) * mPerLat;
  const length = Math.hypot(dx, dy) || 1;

  // Rotate the unit tangent by 90 degrees to get the perpendicular.
  const px = -dy / length;
  const py = dx / length;

  return {
    lat: lat + (py * crossM) / mPerLat,
    lon: lon + (px * crossM) / mPerLon,
  };
}
