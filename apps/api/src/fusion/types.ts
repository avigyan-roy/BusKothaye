import type {
  DebugDecision,
  DebugEvent,
  PublicJourneyEvent,
  RejectReason,
  Role,
} from '@buskothay/shared';
import type { FilterState } from './kalman.js';

/**
 * The complete authoritative state of one journey.
 *
 * This object is what DynamoDB stores under `JOURNEY#id / STATE`, and what a
 * conditional write versions. It is plain JSON-serialisable data with no methods,
 * because every mutation is a pure function from one snapshot to the next — that
 * is what makes a read-modify-conditional-write loop safe on replacement App
 * Runner instances, and what lets the engine be tested against an injected clock
 * with no server at all.
 *
 * It deliberately holds capability *hashes*, never capabilities, so that ending a
 * journey or revoking a contributor is the same atomic write as any other state
 * change. It never holds the raw trajectory; raw reports are separate items with
 * their own retention.
 */

export interface ContributorSnapshot {
  readonly contributorId: string;
  /** Journey-local pseudonym shown in diagnostics, e.g. "source-2". */
  readonly label: string;
  readonly role: Role;
  /** Hash of the capability token. The token itself was returned once and dropped. */
  readonly tokenHash: string;
  readonly joinedAtMs: number;
  readonly revokedAtMs: number | null;

  /** Highest sequence number accepted from this contributor, for dedup ordering. */
  readonly lastSeq: number | null;
  readonly lastReportAtMs: number | null;
  readonly lastAcceptedAtMs: number | null;
  /** When this source last contributed to live fusion; enforces the 1/s ceiling. */
  readonly lastLiveFusionAtMs: number | null;

  /** The source's most recent usable measurement, kept for multi-source fusion. */
  readonly lastSampleSM: number | null;
  readonly lastSampleOffsetM: number | null;
  readonly lastSampleAccuracyM: number | null;
  readonly lastSampleAtMs: number | null;

  readonly reputation: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly lastDecision: RejectReason | null;
  readonly lastWeightShare: number | null;

  /** Set while this source has been outside the corridor; feeds diversion detection. */
  readonly offCorridorSinceMs: number | null;
  /** A large jump awaiting confirmation before it may capture the journey. */
  readonly pendingReentry: { readonly sM: number; readonly atMs: number } | null;
}

/** Modes the stored snapshot can hold. The rest are derived from elapsed time. */
export type BaseMode = 'PENDING' | 'LIVE' | 'DWELLING' | 'ENDED';

export type EndReason = 'driver' | 'inactivity' | 'max_duration';

export interface JourneySnapshot {
  readonly schemaVersion: 1;
  readonly journeyId: string;
  readonly routeId: string;
  readonly routeVersion: string;
  readonly isDemo: boolean;
  readonly createdAtMs: number;
  /** Incremented on every committed mutation; the conditional-write guard. */
  readonly version: number;

  readonly baseMode: BaseMode;
  readonly endedAtMs: number | null;
  readonly endReason: EndReason | null;

  readonly joinCodeHash: string;
  readonly opsTokenHash: string;
  readonly driverContributorId: string;
  readonly contributors: readonly ContributorSnapshot[];

  /** Null until the first accepted fix. A journey with no fix has no position. */
  readonly filter: FilterState | null;
  readonly lastConfirmedAtMs: number | null;
  readonly lastConfirmedSM: number | null;
  /** Slow mean speed over the journey, used as one term of the ETA blend. */
  readonly journeyMeanMps: number | null;

  readonly dwellSinceMs: number | null;
  /** Stops confirmed passed by accepted evidence. Never written by a prediction. */
  readonly passedStopIds: readonly string[];

  readonly offRoute: boolean;
  readonly offRouteSinceMs: number | null;
  readonly ambiguity: string | null;

  readonly events: readonly PublicJourneyEvent[];
  readonly debugEvents: readonly DebugEvent[];
  readonly decisions: readonly DebugDecision[];
  readonly eventSeq: number;

  readonly failedJoinAttempts: number;
  readonly joinLockedUntilMs: number | null;
}
