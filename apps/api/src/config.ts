import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  RATE_LIMIT_CREATE_BURST,
  RATE_LIMIT_CREATE_PER_MINUTE,
  RATE_LIMIT_JOIN_BURST,
  RATE_LIMIT_JOIN_PER_MINUTE,
} from '@buskothay/shared';

/**
 * Environment validation.
 *
 * Every setting is read once, here, and the process refuses to start if the
 * combination is incoherent — a production build pointing at memory persistence,
 * for example. Nothing logs the whole environment; that is how secrets end up in
 * CloudWatch.
 */

const RawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATA_DRIVER: z.enum(['memory', 'dynamodb']).default('memory'),
  AWS_REGION: z.string().min(1).default('ap-south-1'),
  DYNAMODB_TABLE: z.string().min(1).default('buskothay-dev'),
  /** Local DynamoDB only. Must be unset when talking to AWS. */
  DYNAMODB_ENDPOINT: z.string().url().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  ROUTE_DATA_DIR: z.string().default('data/routes'),
  DEFAULT_ROUTE_ID: z.string().default('ac24-patuli-howrah'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TRAFFIC_REFRESH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Number of proxy hops in front of this process. App Runner puts exactly one
   * there. Trusting forwarding headers blindly would let a client choose its own
   * rate-limit bucket.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Rate limits, overridable so that a browser-test run creating a dozen
   * journeys in a minute is not throttled into failures. The defaults are the
   * shared constants; production should leave them alone.
   */
  RATE_LIMIT_CREATE_PER_MINUTE: z.coerce.number().positive().optional(),
  RATE_LIMIT_CREATE_BURST: z.coerce.number().positive().optional(),
  RATE_LIMIT_JOIN_PER_MINUTE: z.coerce.number().positive().optional(),
  RATE_LIMIT_JOIN_BURST: z.coerce.number().positive().optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 30).default(24 * 7),
  /** Restricted service principal used only by the separately supervised demo worker. */
  SIMULATOR_TOKEN: z.string().min(32).optional(),
  /** Server-only bootstrap credentials. Never expose these as VITE_* values. */
  ADMIN_USERNAME: z.string().trim().min(3).max(32).optional(),
  ADMIN_PASSWORD: z.string().min(1).max(200).optional(),
});

export type AppConfig = {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly dataDriver: 'memory' | 'dynamodb';
  readonly awsRegion: string;
  readonly dynamoTable: string;
  readonly dynamoEndpoint: string | undefined;
  readonly corsOrigins: readonly string[];
  readonly routeDataDir: string;
  readonly defaultRouteId: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly trafficRefreshEnabled: boolean;
  readonly trustProxyHops: number;
  readonly rateLimits: {
    readonly createPerMinute: number;
    readonly createBurst: number;
    readonly joinPerMinute: number;
    readonly joinBurst: number;
  };
  readonly sessionTtlMs: number;
  readonly simulatorToken: string | undefined;
  readonly adminUsername: string;
  readonly adminPassword: string;
};

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly problems: string[],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Resolve the route directory.
 *
 * `ROUTE_DATA_DIR` is written relative to the repository root, because that is
 * where the data lives and where the root scripts run. But the API is also
 * started from `apps/api` (its own `dev` script) and from `/app` in the
 * container, so a bare `resolve()` against the current directory would look in
 * the wrong place and the process would die on boot with "no route fixtures".
 * Try the working directory first, then walk up looking for the repository root.
 */
function resolveRouteDataDir(configured: string): string {
  if (isAbsolute(configured)) return configured;

  const fromCwd = resolve(process.cwd(), configured);
  if (existsSync(fromCwd)) return fromCwd;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, configured);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Nothing found. Return the cwd-relative path so the startup error names the
  // place someone actually looked.
  return fromCwd;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = RawEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      'Invalid API configuration',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const raw = parsed.data;

  const corsOrigins = raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const problems: string[] = [];
  if (raw.NODE_ENV === 'production') {
    if (raw.DATA_DRIVER !== 'dynamodb') {
      problems.push(
        'DATA_DRIVER must be "dynamodb" in production; memory state is not durable on App Runner',
      );
    }
    if (raw.DYNAMODB_ENDPOINT !== undefined) {
      problems.push('DYNAMODB_ENDPOINT must be unset in production; it is for local DynamoDB only');
    }
    if (corsOrigins.some((origin) => origin.includes('localhost'))) {
      problems.push('CORS_ORIGINS must not contain localhost in production');
    }
    if (corsOrigins.length === 0) {
      problems.push('CORS_ORIGINS must list the deployed web origins in production');
    }
    if (!raw.ADMIN_USERNAME || !raw.ADMIN_PASSWORD) {
      problems.push('ADMIN_USERNAME and ADMIN_PASSWORD are required in production');
    } else {
      if (raw.ADMIN_PASSWORD.length < 12) {
        problems.push('ADMIN_PASSWORD must be at least 12 characters in production');
      }
      if (
        raw.ADMIN_USERNAME.toLocaleLowerCase('en-US') === 'admin' &&
        raw.ADMIN_PASSWORD === 'admin'
      ) {
        problems.push('The development admin/admin credentials are forbidden in production');
      }
    }
  }
  if ((raw.ADMIN_USERNAME === undefined) !== (raw.ADMIN_PASSWORD === undefined)) {
    problems.push('ADMIN_USERNAME and ADMIN_PASSWORD must be set together');
  }
  if (problems.length > 0) {
    throw new ConfigError('Invalid API configuration', problems);
  }

  return {
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    dataDriver: raw.DATA_DRIVER,
    awsRegion: raw.AWS_REGION,
    dynamoTable: raw.DYNAMODB_TABLE,
    dynamoEndpoint: raw.DYNAMODB_ENDPOINT,
    corsOrigins,
    routeDataDir: resolveRouteDataDir(raw.ROUTE_DATA_DIR),
    defaultRouteId: raw.DEFAULT_ROUTE_ID,
    logLevel: raw.LOG_LEVEL,
    trafficRefreshEnabled: raw.TRAFFIC_REFRESH_ENABLED,
    trustProxyHops: raw.TRUST_PROXY_HOPS,
    rateLimits: {
      createPerMinute: raw.RATE_LIMIT_CREATE_PER_MINUTE ?? RATE_LIMIT_CREATE_PER_MINUTE,
      createBurst: raw.RATE_LIMIT_CREATE_BURST ?? RATE_LIMIT_CREATE_BURST,
      joinPerMinute: raw.RATE_LIMIT_JOIN_PER_MINUTE ?? RATE_LIMIT_JOIN_PER_MINUTE,
      joinBurst: raw.RATE_LIMIT_JOIN_BURST ?? RATE_LIMIT_JOIN_BURST,
    },
    sessionTtlMs: raw.SESSION_TTL_HOURS * 60 * 60 * 1000,
    simulatorToken: raw.SIMULATOR_TOKEN,
    adminUsername: raw.ADMIN_USERNAME ?? 'admin',
    adminPassword: raw.ADMIN_PASSWORD ?? 'admin',
  };
}

/** A one-line, secret-free summary safe to log at startup. */
export function describeConfig(config: AppConfig): string {
  return [
    `env=${config.nodeEnv}`,
    `port=${config.port}`,
    `store=${config.dataDriver}`,
    config.dataDriver === 'dynamodb' ? `table=${config.dynamoTable}` : null,
    config.dynamoEndpoint ? 'dynamodb=local' : null,
    `route=${config.defaultRouteId}`,
    `origins=${config.corsOrigins.length}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}
