import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  interpolateAt,
  metresPerDegreeLatitude,
  metresPerDegreeLongitude,
} from '@buskothay/geometry';
import { prepareRoute, type LocationReport, type PreparedRoute } from '@buskothay/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/observability/logger.js';
import { RouteRegistry } from '../src/routes/route-registry.js';
import { MemoryJourneyRepository } from '../src/store/memory.js';
import type { JourneyRepository } from '../src/store/types.js';

/** The committed AC24 fixture, resolved from the repository root. */
export const ROUTE_DIR = resolve(import.meta.dirname, '../../../data/routes');

let cachedRoute: PreparedRoute | null = null;

export async function loadAc24(): Promise<PreparedRoute> {
  if (cachedRoute !== null) return cachedRoute;
  const raw = JSON.parse(
    await readFile(resolve(ROUTE_DIR, 'ac24-patuli-howrah.json'), 'utf8'),
  ) as unknown;
  cachedRoute = prepareRoute(raw);
  return cachedRoute;
}

/** A coordinate `crossM` metres to the side of the route at distance `sM`. */
export function pointOnRoute(
  route: PreparedRoute,
  sM: number,
  crossM = 0,
): { lat: number; lon: number } {
  const clamped = Math.min(route.dto.lengthM, Math.max(0, sM));
  const [lon, lat] = interpolateAt(route.line, clamped);
  if (crossM === 0) return { lat, lon };

  const [lonB, latB] = interpolateAt(route.line, Math.min(route.dto.lengthM, clamped + 1));
  const mPerLat = metresPerDegreeLatitude(lat);
  const mPerLon = metresPerDegreeLongitude(lat);
  const dx = (lonB - lon) * mPerLon;
  const dy = (latB - lat) * mPerLat;
  const length = Math.hypot(dx, dy) || 1;
  return {
    lat: lat + ((dx / length) * crossM) / mPerLat,
    lon: lon + ((-dy / length) * crossM) / mPerLon,
  };
}

export function reportAt(
  route: PreparedRoute,
  options: {
    seq: number;
    sM: number;
    crossM?: number;
    accuracyM?: number;
    deviceTs?: number;
    sampleAgeMs?: number;
  },
): LocationReport {
  const { lat, lon } = pointOnRoute(route, options.sM, options.crossM ?? 0);
  return {
    seq: options.seq,
    lat,
    lon,
    accuracyM: options.accuracyM ?? 10,
    deviceTs: options.deviceTs ?? Date.now(),
    sampleAgeMs: options.sampleAgeMs ?? 0,
  };
}

export interface TestServer {
  readonly url: string;
  readonly repo: JourneyRepository;
  close(): Promise<void>;
}

/**
 * A real HTTP server on an ephemeral port.
 *
 * Endpoint behaviour is tested through actual requests rather than by calling
 * handlers directly, so the runtime validation, the error contract and the
 * headers are all exercised.
 */
export async function startTestServer(
  env: Record<string, string> = {},
): Promise<TestServer> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DRIVER: 'memory',
    ROUTE_DATA_DIR: ROUTE_DIR,
    CORS_ORIGINS: 'http://localhost:5173',
    LOG_LEVEL: 'error',
    ...env,
  } as NodeJS.ProcessEnv);

  const registry = await RouteRegistry.load(config.routeDataDir);
  const repo = new MemoryJourneyRepository();
  const { app } = createApp({
    config,
    repo,
    registry,
    logger: createLogger('error', () => {}),
  });

  const server: Server = await new Promise((done) => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    repo,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

export interface HttpResult<T> {
  readonly status: number;
  readonly body: T;
  readonly headers: Headers;
}

export async function http<T = unknown>(
  base: string,
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<HttpResult<T>> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: (text.length === 0 ? undefined : JSON.parse(text)) as T,
  };
}
