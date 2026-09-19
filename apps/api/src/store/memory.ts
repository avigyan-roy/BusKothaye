import {
  IDEMPOTENCY_RETENTION_MS,
  JOURNEY_TOMBSTONE_MS,
  RAW_REPORT_RETENTION_MS,
} from '@buskothay/shared';
import type { JourneySnapshot } from '../fusion/types.js';
import type {
  AccountRecord,
  AccountSessionRecord,
  DemoControlRecord,
  IdempotencyRecord,
  JourneyRepository,
  RawReportRecord,
  RouteOverrideRecord,
  StorageHealth,
} from './types.js';

/**
 * In-memory repository for local development and tests.
 *
 * It implements the same conditional-write contract as the DynamoDB adapter so
 * the same tests exercise both, but it is deliberately not durable: a restart
 * loses every journey, and it is refused outright in a production configuration.
 */
export class MemoryJourneyRepository implements JourneyRepository {
  readonly driver = 'memory' as const;

  private readonly journeys = new Map<string, JourneySnapshot>();
  private readonly membership = new Map<string, Set<string>>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly rawReports = new Map<string, RawReportRecord[]>();
  private readonly accountsById = new Map<string, AccountRecord>();
  private readonly accountIdsByUsername = new Map<string, string>();
  private readonly accountSessions = new Map<string, AccountSessionRecord>();
  private readonly routeOverrides = new Map<string, RouteOverrideRecord>();
  private demoControl: DemoControlRecord | null = null;
  private lastWriteOk = true;
  private writeConflicts = 0;
  private droppedDiagnostics = 0;

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async ready(): Promise<boolean> {
    return true;
  }

  async createAccount(account: AccountRecord): Promise<boolean> {
    if (this.accountIdsByUsername.has(account.usernameNormalised)) return false;
    this.accountsById.set(account.accountId, account);
    this.accountIdsByUsername.set(account.usernameNormalised, account.accountId);
    return true;
  }

  async getAccountByUsername(usernameNormalised: string): Promise<AccountRecord | null> {
    const id = this.accountIdsByUsername.get(usernameNormalised);
    return id === undefined ? null : (this.accountsById.get(id) ?? null);
  }

  async getAccountById(accountId: string): Promise<AccountRecord | null> {
    return this.accountsById.get(accountId) ?? null;
  }

  async putAccount(next: AccountRecord, expectedAuthVersion: number): Promise<boolean> {
    const current = this.accountsById.get(next.accountId);
    if (!current || current.authVersion !== expectedAuthVersion) return false;
    this.accountsById.set(next.accountId, next);
    return true;
  }

  async createAccountSession(session: AccountSessionRecord): Promise<void> {
    this.accountSessions.set(session.tokenHash, session);
  }

  async getAccountSession(tokenHash: string): Promise<AccountSessionRecord | null> {
    const session = this.accountSessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAtMs <= this.nowMs()) {
      this.accountSessions.delete(tokenHash);
      return null;
    }
    return session;
  }

  async deleteAccountSession(tokenHash: string): Promise<void> {
    this.accountSessions.delete(tokenHash);
  }

  async getDemoControl(defaultValue: DemoControlRecord): Promise<DemoControlRecord> {
    this.demoControl ??= defaultValue;
    return this.demoControl;
  }

  async putDemoControl(next: DemoControlRecord, expectedRevision: number): Promise<boolean> {
    if (this.demoControl !== null && this.demoControl.revision !== expectedRevision) return false;
    if (this.demoControl === null && expectedRevision !== 0) return false;
    this.demoControl = next;
    return true;
  }

  async acquireDemoLease(input: {
    ownerId: string;
    generation: number;
    nowMs: number;
    expiresAtMs: number;
  }): Promise<boolean> {
    if (!this.demoControl || this.demoControl.generation !== input.generation) return false;
    const lease = this.demoControl.lease;
    if (lease && lease.ownerId !== input.ownerId && lease.expiresAtMs > input.nowMs) return false;
    this.demoControl = {
      ...this.demoControl,
      lease: {
        ownerId: input.ownerId,
        generation: input.generation,
        expiresAtMs: input.expiresAtMs,
      },
    };
    return true;
  }

  async listDemoJourneys(): Promise<JourneySnapshot[]> {
    return [...this.journeys.values()].filter((journey) => journey.isDemo);
  }

  async listRouteOverrides(): Promise<RouteOverrideRecord[]> {
    return [...this.routeOverrides.values()];
  }

  async putRouteOverride(record: RouteOverrideRecord): Promise<void> {
    this.routeOverrides.set(record.route.id, record);
  }

  async createJourney(
    snapshot: JourneySnapshot,
    idempotency: { scope: string; keyHash: string; contributorId: string } | null,
  ): Promise<{ created: true } | { created: false; existing: IdempotencyRecord }> {
    if (idempotency) {
      this.expireIdempotency();
      const key = idempotencyKey(idempotency.scope, idempotency.keyHash);
      const existing = this.idempotency.get(key);
      if (existing) return { created: false, existing };
      this.idempotency.set(key, {
        scope: idempotency.scope,
        keyHash: idempotency.keyHash,
        journeyId: snapshot.journeyId,
        contributorId: idempotency.contributorId,
        createdAtMs: this.nowMs(),
      });
    }

    this.journeys.set(snapshot.journeyId, snapshot);
    const set = this.membership.get(snapshot.routeId) ?? new Set<string>();
    set.add(snapshot.journeyId);
    this.membership.set(snapshot.routeId, set);
    this.lastWriteOk = true;
    return { created: true };
  }

  async getJourney(journeyId: string): Promise<JourneySnapshot | null> {
    const snapshot = this.journeys.get(journeyId);
    if (!snapshot) return null;
    // Tombstones stay readable for a bounded period, then disappear entirely.
    if (
      snapshot.endedAtMs !== null &&
      this.nowMs() - snapshot.endedAtMs > JOURNEY_TOMBSTONE_MS
    ) {
      return null;
    }
    return snapshot;
  }

  async putJourney(next: JourneySnapshot, expectedVersion: number): Promise<boolean> {
    const current = this.journeys.get(next.journeyId);
    if (!current || current.version !== expectedVersion) {
      this.writeConflicts += 1;
      return false;
    }
    this.journeys.set(next.journeyId, next);
    this.lastWriteOk = true;
    return true;
  }

  async recordJoin(
    next: JourneySnapshot,
    expectedVersion: number,
    idempotency: { scope: string; keyHash: string; contributorId: string } | null,
  ): Promise<{ written: true } | { written: false; existing: IdempotencyRecord | null }> {
    if (idempotency) {
      this.expireIdempotency();
      const key = idempotencyKey(idempotency.scope, idempotency.keyHash);
      const existing = this.idempotency.get(key);
      if (existing) return { written: false, existing };
    }
    const ok = await this.putJourney(next, expectedVersion);
    if (!ok) return { written: false, existing: null };
    if (idempotency) {
      this.idempotency.set(idempotencyKey(idempotency.scope, idempotency.keyHash), {
        scope: idempotency.scope,
        keyHash: idempotency.keyHash,
        journeyId: next.journeyId,
        contributorId: idempotency.contributorId,
        createdAtMs: this.nowMs(),
      });
    }
    return { written: true };
  }

  async listJourneys(routeId: string): Promise<JourneySnapshot[]> {
    const ids = this.membership.get(routeId);
    if (!ids) return [];
    const out: JourneySnapshot[] = [];
    for (const id of ids) {
      const snapshot = await this.getJourney(id);
      if (snapshot) out.push(snapshot);
    }
    return out;
  }

  async appendRawReports(records: readonly RawReportRecord[]): Promise<void> {
    for (const record of records) {
      const list = this.rawReports.get(record.journeyId) ?? [];
      list.push(record);
      // Bounded: the memory adapter must not grow without limit during a long run.
      if (list.length > 5000) {
        this.droppedDiagnostics += list.length - 5000;
        list.splice(0, list.length - 5000);
      }
      this.rawReports.set(record.journeyId, list);
    }
  }

  async listRawReports(journeyId: string, nowMs: number): Promise<RawReportRecord[]> {
    const list = this.rawReports.get(journeyId) ?? [];
    // Filter at read time. Expiry is a property of the data, not of a cleanup job.
    return list.filter((r) => nowMs - r.serverTs <= RAW_REPORT_RETENTION_MS);
  }

  async releaseMembership(routeId: string, journeyId: string): Promise<void> {
    this.membership.get(routeId)?.delete(journeyId);
  }

  health(): StorageHealth {
    return {
      driver: this.driver,
      lastWriteOk: this.lastWriteOk,
      writeConflicts: this.writeConflicts,
      droppedDiagnostics: this.droppedDiagnostics,
    };
  }

  async close(): Promise<void> {
    this.journeys.clear();
    this.membership.clear();
    this.idempotency.clear();
    this.rawReports.clear();
    this.accountsById.clear();
    this.accountIdsByUsername.clear();
    this.accountSessions.clear();
    this.routeOverrides.clear();
    this.demoControl = null;
  }

  private expireIdempotency(): void {
    const cutoff = this.nowMs() - IDEMPOTENCY_RETENTION_MS;
    for (const [key, record] of this.idempotency) {
      if (record.createdAtMs < cutoff) this.idempotency.delete(key);
    }
  }
}

function idempotencyKey(scope: string, keyHash: string): string {
  return `${scope}#${keyHash}`;
}
