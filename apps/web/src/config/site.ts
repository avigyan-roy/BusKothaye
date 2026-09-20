/**
 * Branding, and nothing else.
 *
 * There is deliberately no default route, no city and no example stop here. Any
 * such value would be a second opinion about what the system contains, and the
 * database is the only one there should be: the passenger app discovers routes
 * and stops from the API, so a deployment with a completely different network
 * needs no change in this file.
 */
export const site = {
  name: 'BusKothay',
  /** Kept short. It is omitted from the header when space is tight. */
  tagline: 'Know where your bus is.',
  /** Locale of the copy dictionary in `content/`. */
  locale: 'en',
  /** Where a person goes to contribute. */
  drivePath: '/drive',
} as const;

/**
 * Runtime configuration from the build environment.
 *
 * Every `VITE_*` value is public in the built JavaScript. The map key belongs
 * here because a browser map key is public by design and is restricted by
 * permitted actions, origins and expiry — no other kind of credential does.
 */
export interface WebConfig {
  readonly apiBaseUrl: string;
  /** Amazon Location in normal builds; `none` is reserved for deterministic tests. */
  readonly mapProvider: 'amazon' | 'none';
  /** Region containing the Amazon Location browser API key. */
  readonly awsRegion: string;
  /** Public Amazon Location key restricted by action, origin, expiry and quota. */
  readonly locationApiKey: string;
}

export function loadWebConfig(env: {
  VITE_API_BASE_URL?: string | undefined;
  VITE_MAP_PROVIDER?: string | undefined;
  VITE_AWS_REGION?: string | undefined;
  VITE_LOCATION_API_KEY?: string | undefined;
}): WebConfig {
  return {
    apiBaseUrl: (env.VITE_API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
    mapProvider: env.VITE_MAP_PROVIDER === 'none' ? 'none' : 'amazon',
    awsRegion: env.VITE_AWS_REGION ?? 'ap-south-1',
    locationApiKey: env.VITE_LOCATION_API_KEY ?? '',
  };
}

/**
 * Configuration problems that must fail a deployment build.
 *
 * This runs in `vite.config.ts`, not in the browser: a bundle that quietly talks
 * to localhost passes review and is broken for every visitor, so the right place
 * to catch it is the build. Throwing in the browser instead would turn a
 * misconfiguration into a white screen.
 */
export function productionConfigProblems(config: WebConfig): string[] {
  const problems: string[] = [];
  if (config.apiBaseUrl.includes('localhost') || config.apiBaseUrl.includes('127.0.0.1')) {
    problems.push('VITE_API_BASE_URL still points at localhost');
  }
  if (!config.apiBaseUrl.startsWith('https://')) {
    problems.push('VITE_API_BASE_URL must be an https origin');
  }
  if (config.mapProvider !== 'amazon') {
    problems.push('VITE_MAP_PROVIDER must be "amazon" for a deployment build');
  }
  if (config.locationApiKey.length === 0) {
    problems.push('VITE_LOCATION_API_KEY is required for a deployment build');
  }
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(config.awsRegion)) {
    problems.push('VITE_AWS_REGION must be a valid AWS region name');
  }
  return problems;
}
