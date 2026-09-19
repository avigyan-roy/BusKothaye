import {
  DemoFleetConfigSchema,
  SCHEMA_VERSION,
  type Clock,
  type DemoControlDto,
  type DemoFleetConfig,
} from '@buskothay/shared';
import { newId } from '../auth/capabilities.js';
import { ApiProblem, forbidden, routeNotFound, storageUnavailable } from '../http/errors.js';
import type { Logger } from '../observability/logger.js';
import type { RouteRegistry } from '../routes/route-registry.js';
import type { DemoControlRecord, JourneyRepository } from '../store/types.js';
import type { AccountPrincipal } from './account-service.js';
import type { JourneyService } from './journey-service.js';

const AUDIT_LIMIT = 20;
const CONTROL_RETRIES = 6;

export class DemoService {
  constructor(
    private readonly repo: JourneyRepository,
    private readonly journeys: JourneyService,
    private readonly registry: RouteRegistry,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async get(): Promise<DemoControlDto> {
    const nowMs = this.clock.nowMs();
    const control = await this.readControl(nowMs);
    const active = (await this.repo.listDemoJourneys()).filter(
      (journey) => journey.baseMode !== 'ENDED' && journey.demoGeneration === control.generation,
    );
    return toDto(control, active.length);
  }

  async switch(
    principal: AccountPrincipal,
    enabled: boolean,
    patch: Partial<DemoFleetConfig> = {},
  ): Promise<DemoControlDto> {
    requireAdmin(principal);
    return enabled ? this.turnOn(principal, patch) : this.turnOff(principal);
  }

  async update(
    principal: AccountPrincipal,
    patch: Partial<DemoFleetConfig>,
  ): Promise<DemoControlDto> {
    requireAdmin(principal);
    for (let attempt = 0; attempt < CONTROL_RETRIES; attempt += 1) {
      const nowMs = this.clock.nowMs();
      const current = await this.readControl(nowMs);
      const config = { ...current.config, ...patch };
      this.requireConfig(config);
      const next: DemoControlRecord = {
        ...current,
        revision: current.revision + 1,
        config,
        updatedAtMs: nowMs,
        audit: appendAudit(current, principal, 'UPDATED', nowMs),
      };
      if (await this.repo.putDemoControl(next, current.revision)) return this.get();
    }
    throw storageUnavailable();
  }

  async reset(principal: AccountPrincipal): Promise<DemoControlDto> {
    requireAdmin(principal);
    const wasOn = (await this.get()).status !== 'OFF';
    await this.turnOff(principal, 'RESET');
    return wasOn ? this.turnOn(principal, {}) : this.get();
  }

  async acquireLease(principal: AccountPrincipal, ownerId: string, generation: number) {
    if (principal.account.kind !== 'simulator') throw forbidden();
    const nowMs = this.clock.nowMs();
    const control = await this.readControl(nowMs);
    if (control.status !== 'ON' || control.generation !== generation) {
      throw new ApiProblem(409, 'DEMO_DISABLED', 'This demo generation is not active.');
    }
    const acquired = await this.repo.acquireDemoLease({
      ownerId,
      generation,
      nowMs,
      expiresAtMs: nowMs + 15_000,
    });
    return { acquired, generation, expiresAtMs: nowMs + 15_000 };
  }

  private async turnOn(
    principal: AccountPrincipal,
    patch: Partial<DemoFleetConfig>,
  ): Promise<DemoControlDto> {
    for (let attempt = 0; attempt < CONTROL_RETRIES; attempt += 1) {
      const nowMs = this.clock.nowMs();
      const current = await this.readControl(nowMs);
      if (current.status === 'ON' || current.status === 'STARTING') return this.get();
      const config = { ...current.config, ...patch, paused: false, outage: false };
      this.requireConfig(config);
      const next: DemoControlRecord = {
        ...current,
        revision: current.revision + 1,
        generation: current.generation + 1,
        status: 'ON',
        config,
        updatedAtMs: nowMs,
        lease: null,
        audit: appendAudit(current, principal, 'TURNED_ON', nowMs),
      };
      if (await this.repo.putDemoControl(next, current.revision)) {
        this.logger.info('demo fleet enabled', {
          generation: next.generation,
          accountId: principal.account.accountId,
        });
        return this.get();
      }
    }
    throw storageUnavailable();
  }

  private async turnOff(
    principal: AccountPrincipal,
    action: 'TURNED_OFF' | 'RESET' = 'TURNED_OFF',
  ): Promise<DemoControlDto> {
    let fenced: DemoControlRecord | null = null;
    for (let attempt = 0; attempt < CONTROL_RETRIES; attempt += 1) {
      const nowMs = this.clock.nowMs();
      const current = await this.readControl(nowMs);
      if (current.status === 'OFF') return this.get();
      const next: DemoControlRecord = {
        ...current,
        revision: current.revision + 1,
        // Incrementing first fences every in-flight worker request immediately.
        generation: current.generation + 1,
        status: 'STOPPING',
        updatedAtMs: nowMs,
        lease: null,
        audit: appendAudit(current, principal, action, nowMs),
      };
      if (await this.repo.putDemoControl(next, current.revision)) {
        fenced = next;
        break;
      }
    }
    if (!fenced) throw storageUnavailable();

    const demoJourneys = await this.repo.listDemoJourneys();
    await Promise.all(
      demoJourneys
        .filter((journey) => journey.baseMode !== 'ENDED')
        .map((journey) => this.journeys.endJourney(journey.journeyId)),
    );

    for (let attempt = 0; attempt < CONTROL_RETRIES; attempt += 1) {
      const current = await this.readControl(this.clock.nowMs());
      if (current.status === 'OFF') return this.get();
      if (current.generation !== fenced.generation) return this.get();
      const next: DemoControlRecord = {
        ...current,
        revision: current.revision + 1,
        status: 'OFF',
        updatedAtMs: this.clock.nowMs(),
        lease: null,
      };
      if (await this.repo.putDemoControl(next, current.revision)) {
        this.logger.info('demo fleet disabled', { generation: next.generation });
        return this.get();
      }
    }
    throw storageUnavailable();
  }

  private requireConfig(config: DemoFleetConfig): void {
    if (!this.registry.has(config.routeId)) throw routeNotFound();
    const route = this.registry.get(config.routeId);
    if (!route) {
      throw new ApiProblem(409, 'ROUTE_UNAVAILABLE', 'That route has no verified tracking geometry yet.');
    }
    const startIndex =
      config.startStopId === null
        ? -1
        : route.dto.stops.findIndex((stop) => stop.id === config.startStopId);
    const endIndex =
      config.endStopId === null
        ? route.dto.stops.length
        : route.dto.stops.findIndex((stop) => stop.id === config.endStopId);
    const startMissing = config.startStopId !== null && startIndex < 0;
    const endMissing = config.endStopId !== null && endIndex < 0;
    if (startMissing || endMissing || endIndex <= startIndex) {
      throw new ApiProblem(
        409,
        'CONFLICT',
        'Choose a destination checkpoint after the starting checkpoint.',
      );
    }
  }

  /**
   * DynamoDB may still contain a control document written by an older release.
   * Fill newly introduced settings and bring legacy out-of-band speeds back into
   * the current safe demo range before exposing or mutating that document.
   */
  private async readControl(nowMs: number): Promise<DemoControlRecord> {
    const fallback = defaultDemoControl(nowMs);
    const stored = await this.repo.getDemoControl(fallback);
    const candidate = {
      ...fallback.config,
      ...stored.config,
      endStopId: stored.config.endStopId ?? null,
      speedKmh: Math.min(50, Math.max(5, stored.config.speedKmh)),
    };
    const parsed = DemoFleetConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      this.logger.warn('legacy demo configuration was invalid; using safe defaults', {
        revision: stored.revision,
      });
    }
    return {
      ...stored,
      config: parsed.success ? parsed.data : fallback.config,
    };
  }
}

export function defaultDemoControl(nowMs: number): DemoControlRecord {
  return {
    revision: 0,
    generation: 0,
    status: 'OFF',
    config: {
      routeId: 'ac24-patuli-howrah',
      startStopId: null,
      endStopId: null,
      speedKmh: 24,
      busCount: 3,
      sourcesPerBus: 3,
      cadenceMs: 5000,
      noiseM: 8,
      dwellSeconds: 20,
      loop: true,
      paused: false,
      outage: false,
    },
    updatedAtMs: nowMs,
    audit: [],
    lease: null,
  };
}

function appendAudit(
  current: DemoControlRecord,
  principal: AccountPrincipal,
  action: 'TURNED_ON' | 'TURNED_OFF' | 'UPDATED' | 'RESET',
  atMs: number,
) {
  return [
    ...current.audit,
    {
      id: newId('da'),
      atMs,
      accountId: principal.account.accountId,
      username: principal.account.username,
      action,
    },
  ].slice(-AUDIT_LIMIT);
}

function toDto(control: DemoControlRecord, activeJourneyCount: number): DemoControlDto {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: control.revision,
    generation: control.generation,
    status: control.status,
    config: control.config,
    activeJourneyCount,
    updatedAtMs: control.updatedAtMs,
    audit: [...control.audit],
  };
}

export function requireAdmin(principal: AccountPrincipal): void {
  if (principal.account.kind !== 'community' || principal.account.isAdmin !== true) {
    throw forbidden();
  }
}
