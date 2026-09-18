import type { AccountRole, DemoAuditEntry, DemoFleetConfig } from '@buskothay/shared';
import type { JourneySnapshot } from '../fusion/types.js';

export interface AccountRecord {
  readonly accountId: string;
  readonly username: string;
  readonly usernameNormalised: string;
  readonly passwordHash: string;
  readonly role: AccountRole;
  readonly kind: 'community' | 'simulator';
  readonly authVersion: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface AccountSessionRecord {
  readonly tokenHash: string;
  readonly accountId: string;
  readonly authVersion: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface DemoControlRecord {
  readonly revision: number;
  readonly generation: number;
  readonly status: 'OFF' | 'STARTING' | 'ON' | 'STOPPING';
  readonly config: DemoFleetConfig;
  readonly updatedAtMs: number;
  readonly audit: readonly DemoAuditEntry[];
  readonly lease: {
    readonly ownerId: string;
    readonly generation: number;
    readonly expiresAtMs: number;
  } | null;
}

/**
 * One repository interface, two adapters.
 *
 * Memory is for local development and tests and is explicitly not durable.
 * DynamoDB is authoritative in the cloud: every mutation is a read, a pure
 * transition, and a conditional write on `version`. Both adapters obey the same
 * behaviour contract so the same tests run against either.
 */

/** A raw contributor report, retained separately from the journey state. */
export interface RawReportRecord {
  readonly journeyId: string;
  readonly contributorId: string;
  /** Journey-local pseudonym safe for the protected diagnostics page. */
  readonly sourceLabel: string;
  readonly seq: number;
  readonly serverTs: number;
  readonly requestId: string;
  readonly lat: number;
  readonly lon: number;
  readonly accuracyM: number;
  readonly accepted: boolean;
  readonly reason: string | null;
  readonly historyOnly: boolean;
  readonly projectedSM: number | null;
  readonly offsetM: number | null;
  /** Epoch seconds at which this record leaves application access. */
  readonly expiresAtS: number;
}

export interface IdempotencyRecord {
  readonly scope: string;
  readonly keyHash: string;
  readonly journeyId: string;
  readonly contributorId: string;
  readonly createdAtMs: number;
}

export interface StorageHealth {
  readonly driver: 'memory' | 'dynamodb';
  readonly lastWriteOk: boolean;
  readonly writeConflicts: number;
  readonly droppedDiagnostics: number;
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export interface JourneyRepository {
  readonly driver: 'memory' | 'dynamodb';

  /** True once the adapter has confirmed it can reach its backing store. */
  ready(): Promise<boolean>;

  createAccount(account: AccountRecord): Promise<boolean>;
  getAccountByUsername(usernameNormalised: string): Promise<AccountRecord | null>;
  getAccountById(accountId: string): Promise<AccountRecord | null>;
  putAccount(next: AccountRecord, expectedAuthVersion: number): Promise<boolean>;
  createAccountSession(session: AccountSessionRecord): Promise<void>;
  getAccountSession(tokenHash: string): Promise<AccountSessionRecord | null>;
  deleteAccountSession(tokenHash: string): Promise<void>;

  getDemoControl(defaultValue: DemoControlRecord): Promise<DemoControlRecord>;
  putDemoControl(next: DemoControlRecord, expectedRevision: number): Promise<boolean>;
  acquireDemoLease(input: {
    ownerId: string;
    generation: number;
    nowMs: number;
    expiresAtMs: number;
  }): Promise<boolean>;
  listDemoJourneys(): Promise<JourneySnapshot[]>;

  /**
   * Create the journey, its route-membership entry and any idempotency marker
   * together. Returns the existing journey ID when the key has been used before,
   * so the caller can answer with the documented conflict rather than minting a
   * second set of capabilities.
   */
  createJourney(
    snapshot: JourneySnapshot,
    idempotency: { scope: string; keyHash: string; contributorId: string } | null,
  ): Promise<{ created: true } | { created: false; existing: IdempotencyRecord }>;

  /** Strongly consistent read of the authoritative snapshot. */
  getJourney(journeyId: string): Promise<JourneySnapshot | null>;

  /**
   * Conditional write. Returns false on a version conflict so the caller can
   * reload and recompute the whole transition, permission checks included.
   */
  putJourney(next: JourneySnapshot, expectedVersion: number): Promise<boolean>;

  /**
   * Record a join under an idempotency key, atomically with the state mutation.
   * Returns the existing record when the key was already used.
   */
  recordJoin(
    next: JourneySnapshot,
    expectedVersion: number,
    idempotency: { scope: string; keyHash: string; contributorId: string } | null,
  ): Promise<{ written: true } | { written: false; existing: IdempotencyRecord | null }>;

  /** Journeys on a route that have not ended or expired. */
  listJourneys(routeId: string): Promise<JourneySnapshot[]>;

  /** Best-effort diagnostic append. Failure here never invalidates committed state. */
  appendRawReports(records: readonly RawReportRecord[]): Promise<void>;

  /** Raw reports still inside their retention window. */
  listRawReports(journeyId: string, nowMs: number): Promise<RawReportRecord[]>;

  /** Remove a journey's route-membership entry once it has ended. Best effort. */
  releaseMembership(routeId: string, journeyId: string): Promise<void>;

  health(): StorageHealth;

  close(): Promise<void>;
}
