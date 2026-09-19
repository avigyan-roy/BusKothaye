import {
  JOIN_LOCKOUT_MS,
  MAX_CONTRIBUTORS,
  MAX_JOIN_ATTEMPTS,
  RAW_REPORT_RETENTION_MS,
  SCHEMA_VERSION,
  WRITE_CONFLICT_MAX_RETRIES,
  type BoardJourneyResponse,
  toEpochSeconds,
  type Clock,
  type CreateJourneyResponse,
  type DebugDto,
  type JoinJourneyResponse,
  type JoinRole,
  type JourneyStateDto,
  type JourneySummary,
  type LocationReport,
  type LocationResponse,
  type PreparedRoute,
} from '@buskothay/shared';
import {
  addContributor,
  boardableStopIdAt,
  computeDelaySeconds,
  computeStopEtas,
  createJourneySnapshot,
  deriveDebug,
  deriveState,
  derivedModeAt,
  endJourney,
  impliedEnd,
  ingest,
  recordFailedJoin,
  rotateContributorCapability,
  revokeContributor,
  type ContributorSnapshot,
  type JourneySnapshot,
} from '../fusion/index.js';
import {
  hashSecret,
  newId,
  newJoinCode,
  newToken,
  normaliseJoinCode,
  secretMatchesHash,
} from '../auth/capabilities.js';
import type { JourneyRepository, RawReportRecord } from '../store/types.js';
import { StorageUnavailableError } from '../store/types.js';
import type { RouteRegistry } from '../routes/route-registry.js';
import type { Logger } from '../observability/logger.js';
import type { AccountPrincipal } from './account-service.js';
import { defaultDemoControl } from './demo-service.js';
import {
  ApiProblem,
  forbidden,
  journeyEnded,
  journeyNotFound,
  routeNotFound,
  storageUnavailable,
  unauthenticated,
} from '../http/errors.js';

/**
 * Journey use cases: everything between an HTTP handler and the pure engine.
 *
 * The shape of every mutation is the same — read the authoritative snapshot,
 * apply a pure transition, write it conditionally, and recompute from scratch if
 * something else got there first. Nothing is acknowledged as accepted before its
 * state write has committed.
 */

export interface AuthorisedContributor {
  readonly snapshot: JourneySnapshot;
  readonly contributor: ContributorSnapshot;
  readonly isDriver: boolean;
}

export class JourneyService {
  private readonly passengerReadCache = new Map<
    string,
    { readonly snapshot: JourneySnapshot; readonly expiresAtMs: number }
  >();

  constructor(
    private readonly repo: JourneyRepository,
    private readonly registry: RouteRegistry,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  // -------------------------------------------------------------------------
  // Creation and membership.
  // -------------------------------------------------------------------------

  async createJourney(input: {
    routeId: string;
    principal: AccountPrincipal;
    idempotencyKey: string | null;
  }): Promise<CreateJourneyResponse> {
    const route = this.registry.get(input.routeId);
    if (route === null) throw routeNotFound();

    const nowMs = this.clock.nowMs();
    const isDemo = input.principal.account.kind === 'simulator';
    if (!isDemo && input.principal.account.role !== 'driver') throw forbidden();
    const demoGeneration = isDemo
      ? (await this.repo.getDemoControl(defaultDemoControl(nowMs))).generation
      : null;
    if (isDemo) {
      const control = await this.repo.getDemoControl(defaultDemoControl(nowMs));
      if (control.status !== 'ON') {
        throw new ApiProblem(409, 'DEMO_DISABLED', 'The shared demo fleet is switched off.');
      }
    }
    const journeyId = newId('j');
    const contributorId = newId('c');
    const contributorToken = newToken();
    const opsToken = newToken();
    const joinCode = newJoinCode();

    const snapshot = createJourneySnapshot({
      journeyId,
      routeId: route.dto.id,
      routeVersion: route.dto.version,
      isDemo,
      demoGeneration,
      ownerAccountId: input.principal.account.accountId,
      nowMs,
      driverContributorId: contributorId,
      driverTokenHash: hashSecret(contributorToken),
      opsTokenHash: hashSecret(opsToken),
      joinCodeHash: hashSecret(joinCode),
    });

    const result = await this.guardStorage(() =>
      this.repo.createJourney(
        snapshot,
        input.idempotencyKey === null
          ? null
          : {
              scope: 'create',
              keyHash: hashSecret(input.idempotencyKey),
              contributorId,
            },
      ),
    );

    if (!result.created) {
      // The journey exists. Its capabilities were returned exactly once and were
      // not stored, so they cannot be handed out again; issuing different ones
      // would silently split control of the same journey.
      throw new ApiProblem(
        409,
        'CAPABILITY_RESPONSE_UNAVAILABLE',
        'That request was already used to create a journey, and its one-time capabilities cannot be shown again. Start a new journey if you need control of one.',
        [{ path: 'journeyId', reason: result.existing.journeyId }],
      );
    }

    this.logger.info('journey created', {
      journeyId,
      routeId: route.dto.id,
      isDemo,
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      journeyId,
      routeId: route.dto.id,
      routeVersion: route.dto.version,
      contributorId,
      contributorToken,
      opsToken,
      joinCode,
      role: 'driver',
      isDemo,
      createdAtMs: nowMs,
    };
  }

  async joinJourney(input: {
    journeyId: string;
    joinCode: string;
    role: JoinRole;
    principal: AccountPrincipal;
    idempotencyKey: string | null;
  }): Promise<JoinJourneyResponse> {
    const nowMs = this.clock.nowMs();
    const contributorId = newId('c');
    const contributorToken = newToken();
    const idempotency =
      input.idempotencyKey === null
        ? null
        : { scope: 'join', keyHash: hashSecret(input.idempotencyKey), contributorId };

    if (
      input.principal.account.kind === 'community' &&
      input.principal.account.role !== input.role
    ) {
      throw forbidden();
    }

    for (let attempt = 0; attempt <= WRITE_CONFLICT_MAX_RETRIES; attempt += 1) {
      const snapshot = await this.loadActive(input.journeyId);
      if (
        input.principal.account.kind === 'simulator' &&
        (!snapshot.isDemo || snapshot.ownerAccountId !== input.principal.account.accountId)
      ) {
        throw forbidden();
      }

      if (
        snapshot.joinLockedUntilMs !== null &&
        nowMs < snapshot.joinLockedUntilMs
      ) {
        throw new ApiProblem(
          429,
          'RATE_LIMITED',
          'Too many incorrect join codes for this journey. Try again in a few minutes.',
          undefined,
          { 'Retry-After': '60' },
        );
      }

      if (!secretMatchesHash(normaliseJoinCode(input.joinCode), snapshot.joinCodeHash)) {
        const penalised = recordFailedJoin(snapshot, nowMs, MAX_JOIN_ATTEMPTS, JOIN_LOCKOUT_MS);
        await this.repo.putJourney(penalised, snapshot.version);
        throw new ApiProblem(
          400,
          'JOIN_CODE_INVALID',
          'Check the join code and try again.',
        );
      }

      const active = snapshot.contributors.filter((c) => c.revokedAtMs === null);
      if (active.length >= MAX_CONTRIBUTORS) {
        throw new ApiProblem(
          409,
          'JOURNEY_FULL',
          'This journey already has the maximum number of contributors.',
        );
      }

      // A person choosing "conductor" has not proved anything, so the role is a
      // label for diagnostics and a small weighting difference — never a route to
      // driver privileges.
      const next = addContributor(snapshot, {
        contributorId,
        accountId: input.principal.account.accountId,
        role: input.role,
        tokenHash: hashSecret(contributorToken),
        nowMs,
      });

      const written = await this.guardStorage(() =>
        this.repo.recordJoin(next, snapshot.version, idempotency),
      );

      if (written.written) {
        this.cachePassengerSnapshot(next, nowMs);
        return {
          schemaVersion: SCHEMA_VERSION,
          journeyId: snapshot.journeyId,
          routeId: snapshot.routeId,
          contributorId,
          contributorToken,
          role: input.role,
          isDemo: snapshot.isDemo,
          joinedAtMs: nowMs,
        };
      }

      if (written.existing !== null) {
        throw new ApiProblem(
          409,
          'CAPABILITY_RESPONSE_UNAVAILABLE',
          'That request was already used to join this journey, and its one-time capability cannot be shown again. Join again to get a new one.',
        );
      }

      await sleepWithJitter(attempt);
    }

    throw storageUnavailable();
  }

  /**
   * Board without a join code only while the selected stop has fresh confirmed
   * bus evidence. The returned passenger capability feeds the ordinary location
   * ingestion path; there is no privileged demo shortcut.
   */
  async boardJourney(input: {
    journeyId: string;
    stopId: string;
    principal: AccountPrincipal;
    idempotencyKey: string | null;
  }): Promise<BoardJourneyResponse> {
    if (
      input.principal.account.kind !== 'community' ||
      input.principal.account.role !== 'passenger'
    ) {
      throw forbidden();
    }

    const nowMs = this.clock.nowMs();
    const newContributorId = newId('c');
    const contributorToken = newToken();

    for (let attempt = 0; attempt <= WRITE_CONFLICT_MAX_RETRIES; attempt += 1) {
      const snapshot = await this.loadActive(input.journeyId);
      const route = this.requireRoute(snapshot.routeId, snapshot.routeVersion);
      if (boardableStopIdAt(snapshot, route, nowMs) !== input.stopId) {
        throw new ApiProblem(
          409,
          'BOARDING_UNAVAILABLE',
          'This bus is no longer confirmed at the selected stop. Wait for it to arrive and try again.',
        );
      }

      const existing = snapshot.contributors.find(
        (contributor) =>
          contributor.revokedAtMs === null &&
          contributor.accountId === input.principal.account.accountId &&
          contributor.role === 'passenger',
      );
      const contributorId = existing?.contributorId ?? newContributorId;
      const activeCount = snapshot.contributors.filter((c) => c.revokedAtMs === null).length;
      if (!existing && activeCount >= MAX_CONTRIBUTORS) {
        throw new ApiProblem(
          409,
          'JOURNEY_FULL',
          'This journey already has the maximum number of contributors.',
        );
      }

      const next = existing
        ? rotateContributorCapability(snapshot, existing.contributorId, hashSecret(contributorToken))
        : addContributor(snapshot, {
            contributorId,
            accountId: input.principal.account.accountId,
            role: 'passenger',
            tokenHash: hashSecret(contributorToken),
            nowMs,
          });
      const idempotency =
        input.idempotencyKey === null
          ? null
          : { scope: 'board', keyHash: hashSecret(input.idempotencyKey), contributorId };
      const written = await this.guardStorage(() =>
        this.repo.recordJoin(next, snapshot.version, idempotency),
      );

      if (written.written) {
        this.cachePassengerSnapshot(next, nowMs);
        return {
          schemaVersion: SCHEMA_VERSION,
          journeyId: snapshot.journeyId,
          routeId: snapshot.routeId,
          contributorId,
          contributorToken,
          role: 'passenger',
          isDemo: snapshot.isDemo,
          boardedStopId: input.stopId,
          boardedAtMs: nowMs,
          nextSeq: (existing?.lastSeq ?? -1) + 1,
        };
      }
      if (written.existing !== null) {
        throw new ApiProblem(
          409,
          'CAPABILITY_RESPONSE_UNAVAILABLE',
          'That boarding request was already used and its one-time capability cannot be shown again. Press board again to restore access.',
        );
      }
      await sleepWithJitter(attempt);
    }
    throw storageUnavailable();
  }

  // -------------------------------------------------------------------------
  // Authorisation.
  // -------------------------------------------------------------------------

  /** Resolve a bearer token to a contributor on this journey, or refuse. */
  async authoriseContributor(
    journeyId: string,
    token: string | null,
    options: { allowEnded?: boolean } = {},
  ): Promise<AuthorisedContributor> {
    if (token === null) throw unauthenticated();
    // The end endpoint is idempotent for the tombstone period, so it authorises
    // against an ended journey; ingestion and joining do not.
    const snapshot = options.allowEnded
      ? await this.load(journeyId)
      : await this.loadActive(journeyId);
    const contributor = snapshot.contributors.find(
      (c) => c.revokedAtMs === null && secretMatchesHash(token, c.tokenHash),
    );
    if (!contributor) throw unauthenticated();
    return {
      snapshot,
      contributor,
      isDriver: contributor.contributorId === snapshot.driverContributorId,
    };
  }

  /** Driver capability, or the separate read-only ops capability. */
  async authoriseDebugRead(journeyId: string, token: string | null): Promise<JourneySnapshot> {
    if (token === null) throw unauthenticated();
    const snapshot = await this.load(journeyId);
    if (secretMatchesHash(token, snapshot.opsTokenHash)) return snapshot;
    const driver = snapshot.contributors.find(
      (c) => c.contributorId === snapshot.driverContributorId,
    );
    if (driver && secretMatchesHash(token, driver.tokenHash)) return snapshot;
    throw unauthenticated();
  }

  // -------------------------------------------------------------------------
  // Ingestion.
  // -------------------------------------------------------------------------

  async submitLocations(input: {
    journeyId: string;
    contributorId: string;
    reports: readonly LocationReport[];
    receivedAtMs: number;
    requestId: string;
  }): Promise<LocationResponse> {
    const nowMs = this.clock.nowMs();

    for (let attempt = 0; attempt <= WRITE_CONFLICT_MAX_RETRIES; attempt += 1) {
      const snapshot = await this.loadActive(input.journeyId);
      if (snapshot.isDemo) {
        const control = await this.repo.getDemoControl(
          defaultDemoControl(nowMs),
        );
        if (control.status !== 'ON' || control.generation !== snapshot.demoGeneration) {
          throw new ApiProblem(409, 'DEMO_DISABLED', 'The shared demo fleet is switched off.');
        }
      }
      const route = this.requireRoute(snapshot.routeId, snapshot.routeVersion);

      // Re-check permission after every reload: the transition we lost the race to
      // may have been an end or a revoke.
      const contributor = snapshot.contributors.find(
        (c) => c.contributorId === input.contributorId,
      );
      if (!contributor || contributor.revokedAtMs !== null) throw unauthenticated();

      const result = ingest({
        snapshot,
        route,
        contributorId: input.contributorId,
        reports: input.reports,
        receivedAtMs: input.receivedAtMs,
        nowMs,
      });

      const committed = await this.guardStorage(() =>
        this.repo.putJourney(result.snapshot, snapshot.version),
      );

      if (committed) {
        this.cachePassengerSnapshot(result.snapshot, nowMs);
        // Diagnostics are queued only after the state commit, so an accepted
        // decision always corresponds to state that really exists.
        void this.appendRaw(input, result.diagnostics, nowMs).catch((error: unknown) => {
          this.logger.warn('diagnostic append failed', {
            journeyId: input.journeyId,
            error: error instanceof Error ? error.name : 'unknown',
          });
        });

        return {
          schemaVersion: SCHEMA_VERSION,
          results: [...result.decisions],
          serverTs: nowMs,
          stateVersion: result.snapshot.version,
        };
      }

      await sleepWithJitter(attempt);
    }

    // Retries exhausted. Reporting success here would be the one lie that matters.
    throw storageUnavailable();
  }

  private async appendRaw(
    input: { journeyId: string; contributorId: string; reports: readonly LocationReport[]; requestId: string },
    diagnostics: readonly import('@buskothay/shared').DebugDecision[],
    nowMs: number,
  ): Promise<void> {
    const decisionBySeq = new Map(diagnostics.map((decision) => [decision.seq, decision]));
    const records: RawReportRecord[] = input.reports.map((report) => ({
      journeyId: input.journeyId,
      contributorId: input.contributorId,
      sourceLabel: decisionBySeq.get(report.seq)?.sourceLabel ?? 'source-unknown',
      seq: report.seq,
      serverTs: nowMs,
      requestId: input.requestId,
      lat: report.lat,
      lon: report.lon,
      accuracyM: report.accuracyM,
      accepted: decisionBySeq.get(report.seq)?.accepted ?? false,
      reason: decisionBySeq.get(report.seq)?.reason ?? null,
      historyOnly: decisionBySeq.get(report.seq)?.historyOnly ?? false,
      projectedSM: decisionBySeq.get(report.seq)?.projectedSM ?? null,
      offsetM: decisionBySeq.get(report.seq)?.offsetM ?? null,
      expiresAtS: toEpochSeconds(nowMs + RAW_REPORT_RETENTION_MS),
    }));
    await this.repo.appendRawReports(records);
  }

  // -------------------------------------------------------------------------
  // Lifecycle.
  // -------------------------------------------------------------------------

  async revokeSelf(journeyId: string, contributorId: string): Promise<number> {
    for (let attempt = 0; attempt <= WRITE_CONFLICT_MAX_RETRIES; attempt += 1) {
      const snapshot = await this.loadActive(journeyId);
      const contributor = snapshot.contributors.find((c) => c.contributorId === contributorId);
      if (!contributor) throw unauthenticated();
      if (contributor.revokedAtMs !== null) return snapshot.version;

      const nowMs = this.clock.nowMs();
      const next = revokeContributor(snapshot, contributorId, nowMs);
      if (await this.guardStorage(() => this.repo.putJourney(next, snapshot.version))) {
        this.cachePassengerSnapshot(next, nowMs);
        return next.version;
      }
      await sleepWithJitter(attempt);
    }
    throw storageUnavailable();
  }

  async endJourney(journeyId: string): Promise<{ endedAtMs: number; stateVersion: number }> {
    for (let attempt = 0; attempt <= WRITE_CONFLICT_MAX_RETRIES; attempt += 1) {
      const snapshot = await this.load(journeyId);
      if (snapshot.baseMode === 'ENDED' && snapshot.endedAtMs !== null) {
        // Repeated ends from the driver are idempotent for the tombstone period.
        return { endedAtMs: snapshot.endedAtMs, stateVersion: snapshot.version };
      }

      const nowMs = this.clock.nowMs();
      const next = endJourney(snapshot, nowMs, 'driver');
      if (await this.guardStorage(() => this.repo.putJourney(next, snapshot.version))) {
        this.cachePassengerSnapshot(next, nowMs);
        // Membership removal is best effort; list queries filter ended journeys
        // whether or not it succeeds.
        void this.repo.releaseMembership(snapshot.routeId, snapshot.journeyId).catch(() => {});
        this.logger.info('journey ended', { journeyId, reason: 'driver' });
        return { endedAtMs: nowMs, stateVersion: next.version };
      }
      await sleepWithJitter(attempt);
    }
    throw storageUnavailable();
  }

  async authoriseJourneyControl(journeyId: string, principal: AccountPrincipal): Promise<void> {
    const snapshot = await this.load(journeyId);
    if (snapshot.ownerAccountId === principal.account.accountId) return;
    const conductor = snapshot.contributors.find(
      (contributor) =>
        contributor.revokedAtMs === null &&
        contributor.accountId === principal.account.accountId &&
        contributor.role === 'conductor',
    );
    if (!conductor) throw forbidden();
  }

  // -------------------------------------------------------------------------
  // Reads.
  // -------------------------------------------------------------------------

  async getState(journeyId: string): Promise<JourneyStateDto> {
    const nowMs = this.clock.nowMs();
    const cached = this.passengerReadCache.get(journeyId);
    const snapshot =
      cached && cached.expiresAtMs > nowMs
        ? cached.snapshot
        : await this.load(journeyId);
    if (!cached || cached.expiresAtMs <= nowMs) {
      // Coalesce a crowd of one-second polls into one authoritative read while
      // still deriving age, ETA and stale state against the current clock.
      this.passengerReadCache.set(journeyId, {
        snapshot,
        expiresAtMs: nowMs + 900,
      });
    }
    const route = this.requireRoute(snapshot.routeId, snapshot.routeVersion);
    return this.stateOf(snapshot, route, nowMs);
  }

  private stateOf(
    snapshot: JourneySnapshot,
    route: PreparedRoute,
    nowMs: number,
  ): JourneyStateDto {
    return deriveState({
      snapshot,
      route,
      nowMs,
      delaySeconds: computeDelaySeconds(route.dto),
      computeStopEtas: (context) =>
        computeStopEtas({
          route: route.dto,
          mode: context.mode,
          sM: context.sM,
          vMps: context.vMps,
          journeyMeanMps: context.journeyMeanMps,
          offRoute: context.offRoute,
          passedStopIds: context.passedStopIds,
          speedEstablished: context.speedEstablished,
          nowMs,
        }),
    });
  }

  private cachePassengerSnapshot(snapshot: JourneySnapshot, nowMs: number): void {
    this.passengerReadCache.set(snapshot.journeyId, {
      snapshot,
      expiresAtMs: nowMs + 900,
    });
  }

  async getDebug(journeyId: string): Promise<DebugDto> {
    const snapshot = await this.load(journeyId);
    const route = this.requireRoute(snapshot.routeId, snapshot.routeVersion);
    const nowMs = this.clock.nowMs();
    const reports = await this.guardStorage(() => this.repo.listRawReports(journeyId, nowMs));
    return deriveDebug(
      snapshot,
      route,
      nowMs,
      this.repo.health(),
      reports.slice(-100).map((report) => ({
        atMs: report.serverTs,
        sourceLabel: report.sourceLabel,
        seq: report.seq,
        accepted: report.accepted,
        reason: report.reason as import('@buskothay/shared').RejectReason | null,
        historyOnly: report.historyOnly,
        projectedSM: report.projectedSM,
        offsetM: report.offsetM,
      })),
    );
  }

  async listJourneys(routeId: string): Promise<JourneySummary[]> {
    if (!this.registry.has(routeId)) throw routeNotFound();
    const route = this.requireRoute(routeId);
    const nowMs = this.clock.nowMs();
    const snapshots = await this.guardStorage(() => this.repo.listJourneys(routeId));

    return snapshots
      // Expiry is enforced on read, so a journey whose evidence ran out disappears
      // from this list with or without a cleanup pass.
      .filter((snapshot) => impliedEnd(snapshot, nowMs) === null)
      .map((snapshot) => ({
        journeyId: snapshot.journeyId,
        routeId: snapshot.routeId,
        isDemo: snapshot.isDemo,
        mode: derivedModeAt(snapshot, route, nowMs),
        startedAtMs: snapshot.createdAtMs,
        lastConfirmedAtMs: snapshot.lastConfirmedAtMs,
        progressFraction:
          snapshot.lastConfirmedSM === null
            ? null
            : Math.min(1, Math.max(0, snapshot.lastConfirmedSM / route.dto.lengthM)),
        activeSourceCount: countLiveSources(snapshot, nowMs),
      }))
      .sort((a, b) => Number(a.isDemo) - Number(b.isDemo) || b.startedAtMs - a.startedAtMs);
  }

  // -------------------------------------------------------------------------
  // Helpers.
  // -------------------------------------------------------------------------

  private requireRoute(routeId: string, routeVersion?: string): PreparedRoute {
    const route = this.registry.get(routeId, routeVersion);
    if (route === null) throw routeNotFound();
    return route;
  }

  private async load(journeyId: string): Promise<JourneySnapshot> {
    const snapshot = await this.guardStorage(() => this.repo.getJourney(journeyId));
    if (snapshot === null) throw journeyNotFound();
    return snapshot;
  }

  /** Load a journey that must still accept writes. */
  private async loadActive(journeyId: string): Promise<JourneySnapshot> {
    const snapshot = await this.load(journeyId);
    if (snapshot.baseMode === 'ENDED' || impliedEnd(snapshot, this.clock.nowMs()) !== null) {
      throw journeyEnded();
    }
    return snapshot;
  }

  private async guardStorage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        this.logger.error('storage unavailable', { error: error.message });
        throw storageUnavailable();
      }
      throw error;
    }
  }
}

function countLiveSources(snapshot: JourneySnapshot, nowMs: number): number {
  return snapshot.contributors.filter(
    (c) =>
      c.revokedAtMs === null &&
      c.lastAcceptedAtMs !== null &&
      nowMs - c.lastAcceptedAtMs <= 10_000,
  ).length;
}

/** Small randomised backoff so simultaneous writers do not retry in lockstep. */
async function sleepWithJitter(attempt: number): Promise<void> {
  const baseMs = 10 * 2 ** attempt;
  const delay = baseMs + Math.random() * baseMs;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export { forbidden };
