import { defineConfig, devices } from '@playwright/test';

/**
 * Browser journeys against a real API and a real production-style build.
 *
 * Two deliberate choices. The web app is *built and previewed*, not run through
 * the dev server, because "every deep link refreshes after a static build" is one
 * of the things being tested. Routine CI omits an Amazon Location browser key, so it
 * verifies the honest map fallback without making billable calls. A configured
 * deployment smoke test covers Amazon tiles, markers, traffic and attribution.
 *
 * Prerequisite: `npx playwright install --with-deps chromium`.
 * On a machine that already has a browser, set `CHROMIUM_PATH` instead.
 */

const API_PORT = Number(process.env.E2E_API_PORT ?? 3101);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const TEST_SIMULATOR_TOKEN = 'e2e-simulator-token-keep-private-12345';
const WITH_FLEET_WORKER = process.env.E2E_FLEET_WORKER === 'true';

export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',

  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
      : {}),
  },

  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],

  webServer: [
    {
      command: 'node apps/api/dist/server.js',
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        DATA_DRIVER: 'memory',
        ROUTE_DATA_DIR: 'data/routes',
        CORS_ORIGINS: `${WEB_URL},http://127.0.0.1:${WEB_PORT}`,
        LOG_LEVEL: 'error',
        SIMULATOR_TOKEN: TEST_SIMULATOR_TOKEN,
        // A browser run legitimately creates a dozen journeys in a minute. The
        // production limits stay as they are; the API's own tests still cover
        // them with the defaults.
        RATE_LIMIT_CREATE_PER_MINUTE: '600',
        RATE_LIMIT_CREATE_BURST: '60',
        RATE_LIMIT_JOIN_PER_MINUTE: '600',
        RATE_LIMIT_JOIN_BURST: '60',
      },
    },
    ...(WITH_FLEET_WORKER ? [{
      command: 'node scripts/e2e-fleet-worker.mjs',
      url: `http://127.0.0.1:${API_PORT + 1}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'ignore' as const,
      stderr: 'pipe' as const,
      env: {
        API_BASE_URL: API_URL,
        SIMULATOR_TOKEN: TEST_SIMULATOR_TOKEN,
        FLEET_CONTROL_POLL_MS: '250',
        FLEET_HEALTH_PORT: String(API_PORT + 1),
      },
    }] : []),
    {
      command: `npm run build -w @buskothay/web && npm run preview -w @buskothay/web -- --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        VITE_API_BASE_URL: API_URL,
      },
    },
  ],
});

export { API_URL, WEB_URL };
