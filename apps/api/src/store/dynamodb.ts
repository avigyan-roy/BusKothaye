import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  IDEMPOTENCY_RETENTION_MS,
  JOURNEY_TOMBSTONE_MS,
  RAW_REPORT_RETENTION_MS,
  toEpochSeconds,
} from '@buskothay/shared';
import type { JourneySnapshot } from '../fusion/types.js';
import {
  StorageUnavailableError,
  type IdempotencyRecord,
  type JourneyRepository,
  type RawReportRecord,
  type StorageHealth,
} from './types.js';

/**
 * DynamoDB adapter — authoritative state in the cloud.
 *
 * App Runner instance memory is a cache, not a source of truth: instances are
 * replaced on every deployment and there may be more than one. So each mutation
 * reads the current snapshot, applies a pure transition, and writes it back with
 * a condition on `version`. A conflicting write returns false rather than
 * overwriting, and the caller recomputes from the reloaded snapshot — permission
 * and sequence checks included, because the thing it lost the race to may have
 * been an end or a revoke.
 *
 * One table, no GSI, TTL on `ttl` (epoch seconds).
 */

interface DynamoOptions {
  readonly tableName: string;
  readonly region: string;
  readonly endpoint?: string | undefined;
  readonly nowMs?: () => number;
}

const STATE_SK = 'STATE';

export class DynamoJourneyRepository implements JourneyRepository {
  readonly driver = 'dynamodb' as const;

  private readonly client: DynamoDBDocumentClient;
  private readonly table: string;
  private readonly nowMs: () => number;
  private lastWriteOk = true;
  private writeConflicts = 0;
  private droppedDiagnostics = 0;

  constructor(options: DynamoOptions) {
    const base = new DynamoDBClient({
      region: options.region,
      // Credentials come from the runtime provider chain — the App Runner instance
      // role in the cloud. There are deliberately no static keys anywhere here.
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    });
    this.client = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.table = options.tableName;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  async ready(): Promise<boolean> {
    try {
      await this.client.send(
        new GetCommand({
          TableName: this.table,
          Key: { PK: 'HEALTH#probe', SK: STATE_SK },
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async createJourney(
    snapshot: JourneySnapshot,
    idempotency: { scope: string; keyHash: string; contributorId: string } | null,
  ): Promise<{ created: true } | { created: false; existing: IdempotencyRecord }> {
    if (idempotency) {
      const existing = await this.getIdempotency(idempotency.scope, idempotency.keyHash);
      if (existing) return { created: false, existing };
    }

    const items: NonNullable<
      ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
    > = [
      {
        Put: {
          TableName: this.table,
          Item: {
            PK: journeyPk(snapshot.journeyId),
            SK: STATE_SK,
            snapshot,
            version: snapshot.version,
            ttl: toEpochSeconds(snapshot.createdAtMs + JOURNEY_TOMBSTONE_MS * 2),
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName: this.table,
          Item: {
            PK: routePk(snapshot.routeId),
            SK: `ACTIVE#${snapshot.journeyId}`,
            journeyId: snapshot.journeyId,
            createdAtMs: snapshot.createdAtMs,
            ttl: toEpochSeconds(snapshot.createdAtMs + JOURNEY_TOMBSTONE_MS * 2),
          },
        },
      },
    ];

    if (idempotency) {
      items.push({
        Put: {
          TableName: this.table,
          Item: {
            PK: idempotencyPk(idempotency.scope, idempotency.keyHash),
            SK: 'RESULT',
            record: {
              scope: idempotency.scope,
              keyHash: idempotency.keyHash,
              journeyId: snapshot.journeyId,
              contributorId: idempotency.contributorId,
              createdAtMs: this.nowMs(),
            } satisfies IdempotencyRecord,
            ttl: toEpochSeconds(this.nowMs() + IDEMPOTENCY_RETENTION_MS),
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
    }

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: items }));
      this.lastWriteOk = true;
      return { created: true };
    } catch (error) {
      if (idempotency && isConditionalFailure(error)) {
        const existing = await this.getIdempotency(idempotency.scope, idempotency.keyHash);
        if (existing) return { created: false, existing };
      }
      this.lastWriteOk = false;
      throw new StorageUnavailableError(
        `Could not create journey: ${errorName(error)}`,
      );
    }
  }

  async getJourney(journeyId: string): Promise<JourneySnapshot | null> {
    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.table,
          Key: { PK: journeyPk(journeyId), SK: STATE_SK },
          // Fusion decisions are made against this read, so eventual consistency
          // is not good enough.
          ConsistentRead: true,
        }),
      );
      const snapshot = result.Item?.['snapshot'] as JourneySnapshot | undefined;
      if (!snapshot) return null;
      if (
        snapshot.endedAtMs !== null &&
        this.nowMs() - snapshot.endedAtMs > JOURNEY_TOMBSTONE_MS
      ) {
        // TTL deletion is asynchronous, so expiry is enforced on read.
        return null;
      }
      return snapshot;
    } catch (error) {
      throw new StorageUnavailableError(`Could not read journey: ${errorName(error)}`);
    }
  }

  async putJourney(next: JourneySnapshot, expectedVersion: number): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            PK: journeyPk(next.journeyId),
            SK: STATE_SK,
            snapshot: next,
            version: next.version,
            ttl: toEpochSeconds(
              (next.endedAtMs ?? this.nowMs()) + JOURNEY_TOMBSTONE_MS * 2,
            ),
          },
          ConditionExpression: 'version = :expected',
          ExpressionAttributeValues: { ':expected': expectedVersion },
        }),
      );
      this.lastWriteOk = true;
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) {
        this.writeConflicts += 1;
        return false;
      }
      this.lastWriteOk = false;
      throw new StorageUnavailableError(`Could not write journey: ${errorName(error)}`);
    }
  }

  async recordJoin(
    next: JourneySnapshot,
    expectedVersion: number,
    idempotency: { scope: string; keyHash: string; contributorId: string } | null,
  ): Promise<{ written: true } | { written: false; existing: IdempotencyRecord | null }> {
    if (!idempotency) {
      const ok = await this.putJourney(next, expectedVersion);
      return ok ? { written: true } : { written: false, existing: null };
    }

    const existing = await this.getIdempotency(idempotency.scope, idempotency.keyHash);
    if (existing) return { written: false, existing };

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: {
                  PK: journeyPk(next.journeyId),
                  SK: STATE_SK,
                  snapshot: next,
                  version: next.version,
                  ttl: toEpochSeconds(this.nowMs() + JOURNEY_TOMBSTONE_MS * 2),
                },
                ConditionExpression: 'version = :expected',
                ExpressionAttributeValues: { ':expected': expectedVersion },
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: {
                  PK: idempotencyPk(idempotency.scope, idempotency.keyHash),
                  SK: 'RESULT',
                  record: {
                    scope: idempotency.scope,
                    keyHash: idempotency.keyHash,
                    journeyId: next.journeyId,
                    contributorId: idempotency.contributorId,
                    createdAtMs: this.nowMs(),
                  } satisfies IdempotencyRecord,
                  ttl: toEpochSeconds(this.nowMs() + IDEMPOTENCY_RETENTION_MS),
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
      this.lastWriteOk = true;
      return { written: true };
    } catch (error) {
      if (isConditionalFailure(error)) {
        this.writeConflicts += 1;
        const replay = await this.getIdempotency(idempotency.scope, idempotency.keyHash);
        return { written: false, existing: replay };
      }
      this.lastWriteOk = false;
      throw new StorageUnavailableError(`Could not record join: ${errorName(error)}`);
    }
  }

  async listJourneys(routeId: string): Promise<JourneySnapshot[]> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': routePk(routeId), ':prefix': 'ACTIVE#' },
          Limit: 100,
        }),
      );
      const ids = (result.Items ?? []).map((item) => String(item['journeyId']));
      const snapshots = await Promise.all(ids.map((id) => this.getJourney(id)));
      return snapshots.filter((s): s is JourneySnapshot => s !== null);
    } catch (error) {
      throw new StorageUnavailableError(`Could not list journeys: ${errorName(error)}`);
    }
  }

  async appendRawReports(records: readonly RawReportRecord[]): Promise<void> {
    if (records.length === 0) return;
    // Diagnostics are best effort by design: committed fusion state must never be
    // rolled back because a log write failed.
    for (let i = 0; i < records.length; i += 25) {
      const chunk = records.slice(i, i + 25);
      try {
        const result = await this.client.send(
          new BatchWriteCommand({
            RequestItems: {
              [this.table]: chunk.map((record) => ({
                PutRequest: {
                  Item: {
                    PK: journeyPk(record.journeyId),
                    // Collision-safe even inside one millisecond.
                    SK: `UPD#${record.serverTs}#${record.contributorId}#${record.seq}#${record.requestId}`,
                    ...record,
                    ttl: record.expiresAtS,
                  },
                },
              })),
            },
          }),
        );
        const unprocessed = result.UnprocessedItems?.[this.table]?.length ?? 0;
        this.droppedDiagnostics += unprocessed;
      } catch {
        this.droppedDiagnostics += chunk.length;
      }
    }
  }

  async listRawReports(journeyId: string, nowMs: number): Promise<RawReportRecord[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': journeyPk(journeyId), ':prefix': 'UPD#' },
        Limit: 500,
      }),
    );
    // TTL deletion is asynchronous, so expired records are filtered here rather
    // than assumed gone.
    return (result.Items ?? [])
      .map((item) => item as unknown as RawReportRecord)
      .filter((r) => nowMs - r.serverTs <= RAW_REPORT_RETENTION_MS);
  }

  async releaseMembership(routeId: string, journeyId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { PK: routePk(routeId), SK: `ACTIVE#${journeyId}` },
        }),
      );
    } catch {
      // Queries filter ended journeys regardless, so this is safe to lose.
    }
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
    this.client.destroy();
  }

  private async getIdempotency(
    scope: string,
    keyHash: string,
  ): Promise<IdempotencyRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { PK: idempotencyPk(scope, keyHash), SK: 'RESULT' },
        ConsistentRead: true,
      }),
    );
    const record = result.Item?.['record'] as IdempotencyRecord | undefined;
    if (!record) return null;
    if (this.nowMs() - record.createdAtMs > IDEMPOTENCY_RETENTION_MS) return null;
    return record;
  }
}

function journeyPk(journeyId: string): string {
  return `JOURNEY#${journeyId}`;
}

function routePk(routeId: string): string {
  return `ROUTE#${routeId}`;
}

function idempotencyPk(scope: string, keyHash: string): string {
  return `IDEMPOTENCY#${scope}#${keyHash}`;
}

function isConditionalFailure(error: unknown): boolean {
  const name = errorName(error);
  return (
    name === 'ConditionalCheckFailedException' ||
    name === 'TransactionCanceledException'
  );
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error) {
    return String((error as { name: unknown }).name);
  }
  return 'UnknownError';
}
