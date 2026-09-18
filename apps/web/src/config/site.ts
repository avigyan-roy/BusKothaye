/**
 * Branding and the one route this release ships.
 *
 * Components read these values; the strings "BusKothay", "AC24" and "Patuli" do
 * not appear scattered through JSX. Changing the product name is a one-line edit
 * here plus the browser title, which is derived from it.
 */
export const site = {
  name: 'BusKothay',
  /** Kept short. It is omitted from the map header when space is tight. */
  tagline: 'Know where your bus is.',
  defaultRouteId: 'ac24-patuli-howrah',
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
 * permitted actions, referrers and expiry — no other kind of credential does.
 */
export interface WebConfig {
  readonly apiBaseUrl: string;
  /**
   * `amazon` in production, `demo` for credential-free development, and `none`
   * for browser tests, which must not depend on an external tile server.
   */
  readonly mapProvider: 'demo' | 'amazon' | 'none';
  readonly awsRegion: string;
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
    mapProvider:
      env.VITE_MAP_PROVIDER === 'amazon'
        ? 'amazon'
        : env.VITE_MAP_PROVIDER === 'none'
          ? 'none'
          : 'demo',
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
  if (config.mapProvider === 'amazon' && config.locationApiKey.length === 0) {
    problems.push('VITE_LOCATION_API_KEY is required when VITE_MAP_PROVIDER is "amazon"');
  }
  if (config.mapProvider !== 'amazon') {
    problems.push(
      `VITE_MAP_PROVIDER is "${config.mapProvider}". Only "amazon" is a production street map; set it with a restricted browser key before deploying`,
    );
  }
  return problems;
}
