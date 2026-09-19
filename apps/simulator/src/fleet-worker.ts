#!/usr/bin/env node
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { prepareFromDto, type DemoControlDto, type LocationReport, type PreparedRoute } from '@buskothay/shared';
import { ApiClient, SimulatorApiError } from './client.js';
import { createRng } from './rng.js';
import { offsetFromRoute } from './source.js';

interface FleetSource {
  readonly token: string;
  seq: number;
}

interface FleetBus {
  readonly journeyId: string;
  readonly sources: FleetSource[];
  sM: number;
  lastTickMs: number;
  lastSentAtMs: number;
  dwellUntilMs: number;
  nextStopIndex: number;
}

const apiUrl = (process.env.API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const token = process.env.SIMULATOR_TOKEN;
const pollMs = positiveInteger(process.env.FLEET_CONTROL_POLL_MS, 2000);
const ownerId = `fleet-${randomUUID()}`;
const api = new ApiClient(apiUrl, token);
const rng = createRng(hashSeed(ownerId));

let stopped = false;
let route: PreparedRoute | null = null;
let buses: FleetBus[] = [];
let fleetKey = '';
let routeStartSM = 0;
let routeEndSM = 0;

process.on('SIGTERM', () => { stopped = true; });
process.on('SIGINT', () => { stopped = true; });

async function main(): Promise<void> {
  if (!token) throw new Error('SIMULATOR_TOKEN is required by the persistent fleet worker.');
  log(`worker ${ownerId} watching ${apiUrl}`);

  while (!stopped) {
    try {
      const control = await api.demoControl();
      if (control.status !== 'ON') {
        route = null;
        buses = [];
        fleetKey = '';
        await sleep(pollMs);
        continue;
      }

      const lease = await api.acquireDemoLease(ownerId, control.generation);
      if (!lease.acquired) {
        await sleep(pollMs);
        continue;
      }

      await reconcile(control);
      await tick(control);
    } catch (error) {
      if (error instanceof SimulatorApiError && error.code === 'DEMO_DISABLED') {
        buses = [];
        route = null;
        fleetKey = '';
      } else {
        log(`control cycle failed: ${describe(error)}`);
      }
    }
    await sleep(Math.min(pollMs, 1000));
  }

  log('worker stopped');
}

async function reconcile(control: DemoControlDto): Promise<void> {
  const config = control.config;
  const desiredKey = [
    control.generation,
    config.routeId,
    config.startStopId ?? 'origin',
    config.endStopId ?? 'destination',
    config.busCount,
    config.sourcesPerBus,
  ].join(':');
  if (desiredKey === fleetKey && route !== null && buses.length === config.busCount) return;

  if (buses.length > 0) {
    await Promise.allSettled(buses.map((bus) => api.end(bus.journeyId)));
  }

  route = prepareFromDto(await api.getRoute(config.routeId));
  const selectedStart = config.startStopId
    ? route.dto.stops.find((stop) => stop.id === config.startStopId)?.sM
    : undefined;
  const baseStart = selectedStart ?? 0;
  const selectedEnd = config.endStopId
    ? route.dto.stops.find((stop) => stop.id === config.endStopId)?.sM
    : undefined;
  routeStartSM = baseStart;
  routeEndSM = selectedEnd ?? route.dto.lengthM;
  const dispatchLengthM = Math.max(1, routeEndSM - routeStartSM);
  const created: FleetBus[] = [];

  for (let index = 0; index < config.busCount; index += 1) {
    const journey = await api.createJourney(config.routeId);
    const sources: FleetSource[] = [{ token: journey.contributorToken, seq: 0 }];
    for (let sourceIndex = 1; sourceIndex < config.sourcesPerBus; sourceIndex += 1) {
      const joined = await api.join(journey.journeyId, journey.joinCode, 'passenger');
      sources.push({ token: joined.contributorToken, seq: 0 });
    }
    const spacing = dispatchLengthM / Math.max(1, config.busCount);
    const sM = config.loop
      ? baseStart + index * spacing
      : Math.min(routeEndSM, baseStart + index * Math.min(500, spacing));
    created.push({
      journeyId: journey.journeyId,
      sources,
      sM,
      lastTickMs: Date.now(),
      lastSentAtMs: 0,
      dwellUntilMs: 0,
      nextStopIndex: firstStopAfter(route, sM),
    });
  }

  buses = created;
  fleetKey = desiredKey;
  log(`generation ${control.generation}: ${buses.length} bus(es), ${config.sourcesPerBus} source(s) each`);
}

async function tick(control: DemoControlDto): Promise<void> {
  if (!route) return;
  const nowMs = Date.now();
  const config = control.config;

  for (const bus of buses) {
    const elapsedS = Math.max(0, (nowMs - bus.lastTickMs) / 1000);
    bus.lastTickMs = nowMs;
    if (!config.paused && nowMs >= bus.dwellUntilMs) {
      const before = bus.sM;
      bus.sM += (config.speedKmh / 3.6) * elapsedS;
      const nextStop = route.dto.stops[bus.nextStopIndex];
      if (nextStop && before < nextStop.sM && bus.sM >= nextStop.sM) {
        bus.sM = nextStop.sM;
        bus.dwellUntilMs = nowMs + config.dwellSeconds * 1000;
        bus.nextStopIndex += 1;
      }
      if (bus.sM >= routeEndSM) {
        if (config.loop) {
          if (bus.dwellUntilMs > nowMs) {
            bus.sM = routeEndSM;
          } else {
            const dispatchLengthM = Math.max(1, routeEndSM - routeStartSM);
            bus.sM = routeStartSM + ((bus.sM - routeStartSM) % dispatchLengthM);
            bus.nextStopIndex = firstStopAfter(route, bus.sM);
          }
        } else {
          bus.sM = routeEndSM;
        }
      }
    }

    if (config.outage || nowMs - bus.lastSentAtMs < config.cadenceMs) continue;
    bus.lastSentAtMs = nowMs;
    await Promise.all(
      bus.sources.map(async (source) => {
        source.seq += 1;
        const coordinate = offsetFromRoute(
          route!,
          bus.sM,
          rng.normal(0, config.noiseM),
        );
        const report: LocationReport = {
          seq: source.seq,
          lat: coordinate.lat,
          lon: coordinate.lon,
          accuracyM: Math.max(5, config.noiseM * 2),
          deviceTs: nowMs,
          sampleAgeMs: 0,
          speedMps: config.paused ? 0 : config.speedKmh / 3.6,
        };
        try {
          await api.report(bus.journeyId, source.token, [report]);
        } catch (error) {
          if (!(error instanceof SimulatorApiError && error.status === 429)) {
            log(`report failed for ${bus.journeyId}: ${describe(error)}`);
          }
        }
      }),
    );
  }
}

function firstStopAfter(prepared: PreparedRoute, sM: number): number {
  const index = prepared.dto.stops.findIndex((stop) => stop.sM > sM + 1);
  return index < 0 ? prepared.dto.stops.length : index;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${describe(error)}\n`);
  process.exitCode = 1;
});
