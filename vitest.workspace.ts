import { defineWorkspace } from 'vitest/config';

/**
 * Test projects.
 *
 * `geometry` and `shared` are pure maths and contract checks. `api` covers the
 * fusion engine with an injected clock and the HTTP surface against a real
 * ephemeral server. `web` covers the presentation decisions that would mislead
 * a passenger if they were wrong — what the clock says and which stop the bus
 * is at — which are plain functions on purpose so they can be tested without a
 * browser. None of them need AWS credentials or a network.
 *
 * Browser journeys live in the Playwright suite (`npm run test:e2e`), and the
 * real-time scenario library lives in the simulator (`npm run simulate`), because
 * both need real elapsed time and neither belongs in a unit-test run.
 */
export default defineWorkspace([
  {
    test: {
      name: 'geometry',
      root: './packages/geometry',
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'shared',
      root: './packages/shared',
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'api',
      root: './apps/api',
      include: ['test/**/*.test.ts'],
      environment: 'node',
      // Fusion tests travel through minutes of simulated time in milliseconds,
      // but the HTTP tests start real servers.
      testTimeout: 20000,
    },
  },
  {
    test: {
      name: 'web',
      root: './apps/web',
      include: ['src/**/*.test.ts'],
      environment: 'node',
    },
  },
]);
