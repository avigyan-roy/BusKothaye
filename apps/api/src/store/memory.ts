import {
  IDEMPOTENCY_RETENTION_MS,
  JOURNEY_TOMBSTONE_MS,
  RAW_REPORT_RETENTION_MS,
} from '@buskothay/shared';
import type { JourneySnapshot } from '../fusion/types.js';
import type {
  IdempotencyRecord,
  JourneyRepository,
  RawReportRecord,
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
  private lastWriteOk = true;
  private writeConflicts = 0;
  private droppedDiagnostics = 0;

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async ready(): Promise<boolean> {
    return true;
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
