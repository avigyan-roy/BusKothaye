import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
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
  type AccountRecord,
  type AccountSessionRecord,
  type DemoControlRecord,
  type IdempotencyRecord,
  type JourneyRepository,
  type RawReportRecord,
  type RouteOverrideRecord,
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

  async createAccount(account: AccountRecord): Promise<boolean> {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: {
                  PK: accountPk(account.accountId),
                  SK: 'PROFILE',
                  account,
                  authVersion: account.authVersion,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: {
                  PK: usernamePk(account.usernameNormalised),
                  SK: 'ACCOUNT',
                  accountId: account.accountId,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw new StorageUnavailableError(`Could not create account: ${errorName(error)}`);
    }
  }

  async getAccountByUsername(usernameNormalised: string): Promise<AccountRecord | null> {
    try {
      const pointer = await this.client.send(
        new GetCommand({
          TableName: this.table,
          Key: { PK: usernamePk(usernameNormalised), SK: 'ACCOUNT' },
          ConsistentRead: true,
        }),
      );
      const accountId = pointer.Item?.['accountId'];
      return typeof accountId === 'string' ? this.getAccountById(accountId) : null;
    } catch (error) {
      throw new StorageUnavailableError(`Could not read account: ${errorName(error)}`);
    }
  }

  async getAccountById(accountId: string): Promise<AccountRecord | null> {
    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.table,
          Key: { PK: accountPk(accountId), SK: 'PROFILE' },
          ConsistentRead: true,
        }),
      );
      return (result.Item?.['account'] as AccountRecord | undefined) ?? null;
    } catch (error) {
      throw new StorageUnavailableError(`Could not read account: ${errorName(error)}`);
    }
  }

  async putAccount(next: AccountRecord, expectedAuthVersion: number): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            PK: accountPk(next.accountId),
            SK: 'PROFILE',
            account: next,
            authVersion: next.authVersion,
          },
          ConditionExpression: 'authVersion = :expected',
          ExpressionAttributeValues: { ':expected': expectedAuthVersion },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw new StorageUnavailableError(`Could not update account: ${errorName(error)}`);
    }
  }

  async createAccountSession(session: AccountSessionRecord): Promise<void> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            PK: sessionPk(session.tokenHash),
            SK: 'SESSION',
            session,
            ttl: toEpochSeconds(session.expiresAtMs),
          },
        }),
      );
    } catch (error) {
      throw new StorageUnavailableError(`Could not create session: ${errorName(error)}`);
    }
  }

  async getAccountSession(tokenHash: string): Promise<AccountSessionRecord | null> {
    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.table,
          Key: { PK: sessionPk(tokenHash), SK: 'SESSION' },
          ConsistentRead: true,
        }),
      );
      const session = result.Item?.['session'] as AccountSessionRecord | undefined;
      if (!session || session.expiresAtMs <= this.nowMs()) return null;
      return session;
    } catch (error) {
      throw new StorageUnavailableError(`Could not read session: ${errorName(error)}`);
    }
  }

  async deleteAccountSession(tokenHash: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { PK: sessionPk(tokenHash), SK: 'SESSION' },
        }),
      );
    } catch (error) {
      throw new StorageUnavailableError(`Could not delete session: ${errorName(error)}`);
    }
  }

  async getDemoControl(defaultValue: DemoControlRecord): Promise<DemoControlRecord> {
    const key = { PK: 'CONTROL#DEMO', SK: 'STATE' };
    try {
      const existing = await this.client.send(
        new GetCommand({ TableName: this.table, Key: key, ConsistentRead: true }),
      );
      if (existing.Item?.['control']) return existing.Item['control'] as DemoControlRecord;
      try {
        await this.client.send(
          new PutCommand({
            TableName: this.table,
            Item: { ...key, control: defaultValue, revision: defaultValue.revision },
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        );
        return defaultValue;
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        const raced = await this.client.send(
          new GetCommand({ TableName: this.table, Key: key, ConsistentRead: true }),
        );
        return (raced.Item?.['control'] as DemoControlRecord | undefined) ?? defaultValue;
      }
    } catch (error) {
      throw new StorageUnavailableError(`Could not read demo control: ${errorName(error)}`);
    }
  }

  async putDemoControl(next: DemoControlRecord, expectedRevision: number): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: { PK: 'CONTROL#DEMO', SK: 'STATE', control: next, revision: next.revision },
          ConditionExpression: 'revision = :expected',
          ExpressionAttributeValues: { ':expected': expectedRevision },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw new StorageUnavailableError(`Could not write demo control: ${errorName(error)}`);
    }
  }

  async acquireDemoLease(input: {
    ownerId: string;
    generation: number;
    nowMs: number;
    expiresAtMs: number;
  }): Promise<boolean> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: 'CONTROL#DEMO', SK: 'STATE' },
          UpdateExpression:
            'SET control.lease = :lease',
          ConditionExpression:
            'control.generation = :generation AND (attribute_not_exists(control.lease) OR control.lease.expiresAtMs <= :now OR control.lease.ownerId = :owner)',
          ExpressionAttributeValues: {
            ':generation': input.generation,
            ':now': input.nowMs,
            ':owner': input.ownerId,
            ':lease': {
              ownerId: input.ownerId,
              generation: input.generation,
              expiresAtMs: input.expiresAtMs,
            },
          },
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw new StorageUnavailableError(`Could not acquire demo lease: ${errorName(error)}`);
    }
  }

  async listDemoJourneys(): Promise<JourneySnapshot[]> {
    return this.listMembership('DEMO#ACTIVE');
  }

  async listRouteOverrides(): Promise<RouteOverrideRecord[]> {
    try {
      const records: RouteOverrideRecord[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': 'CONFIG#ROUTES', ':prefix': 'ROUTE#' },
            ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
          }),
        );
        for (const item of result.Items ?? []) {
          const record = item['record'] as RouteOverrideRecord | undefined;
          if (record) records.push(record);
        }
        exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (exclusiveStartKey);
      return records;
    } catch (error) {
      throw new StorageUnavailableError(`Could not list route overrides: ${errorName(error)}`);
    }
  }

  async putRouteOverride(record: RouteOverrideRecord): Promise<void> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            PK: 'CONFIG#ROUTES',
            SK: `ROUTE#${record.route.id}`,
            record,
          },
        }),
      );
    } catch (error) {
      throw new StorageUnavailableError(`Could not save route override: ${errorName(error)}`);
    }
  }

  async deleteRouteOverride(routeId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { PK: 'CONFIG#ROUTES', SK: `ROUTE#${routeId}` },
        }),
      );
    } catch (error) {
      throw new StorageUnavailableError(`Could not delete route override: ${errorName(error)}`);
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
          ConditionExpression: 'attribute_not_exists(PK) OR ttl < :now',
          ExpressionAttributeValues: { ':now': toEpochSeconds(this.nowMs()) },
        },
      });
    }

    if (snapshot.isDemo) {
      items.push({
        Put: {
          TableName: this.table,
          Item: {
            PK: 'DEMO#ACTIVE',
            SK: `ACTIVE#${snapshot.journeyId}`,
            journeyId: snapshot.journeyId,
            ttl: toEpochSeconds(snapshot.createdAtMs + JOURNEY_TOMBSTONE_MS * 2),
          },
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
                ConditionExpression: 'attribute_not_exists(PK) OR ttl < :now',
                ExpressionAttributeValues: { ':now': toEpochSeconds(this.nowMs()) },
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
    return this.listMembership(routePk(routeId));
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
      await Promise.all([
        this.client.send(
          new DeleteCommand({
            TableName: this.table,
            Key: { PK: routePk(routeId), SK: `ACTIVE#${journeyId}` },
          }),
        ),
        this.client.send(
          new DeleteCommand({
            TableName: this.table,
            Key: { PK: 'DEMO#ACTIVE', SK: `ACTIVE#${journeyId}` },
          }),
        ),
      ]);
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

  private async listMembership(pk: string): Promise<JourneySnapshot[]> {
    try {
      const ids: string[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await this.client.send(
          new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
            ExpressionAttributeValues: { ':pk': pk, ':prefix': 'ACTIVE#' },
            Limit: 100,
            ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
          }),
        );
        ids.push(...(result.Items ?? []).map((item) => String(item['journeyId'])));
        exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (exclusiveStartKey);
      const snapshots = await Promise.all(ids.map((id) => this.getJourney(id)));
      return snapshots.filter((snapshot): snapshot is JourneySnapshot => snapshot !== null);
    } catch (error) {
      throw new StorageUnavailableError(`Could not list journeys: ${errorName(error)}`);
    }
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

function accountPk(accountId: string): string {
  return `ACCOUNT#${accountId}`;
}

function usernamePk(username: string): string {
  return `USERNAME#${username}`;
}

function sessionPk(tokenHash: string): string {
  return `SESSION#${tokenHash}`;
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
