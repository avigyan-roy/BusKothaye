import type { APIRequestContext, Page } from '@playwright/test';
import {
  interpolateAt,
  preparePolyline,
  type LonLat,
} from '@buskothay/geometry';

/**
 * Helpers shared by the browser tests.
 *
 * Journeys are driven through the same public API a contributor's phone uses.
 * There is no test-only endpoint, and the browser's own network is never
 * replaced with mocks — otherwise the suite would be testing the mocks.
 */

export const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3101';
export const ROUTE_ID = 'ac24-patuli-howrah';
export const TEST_SIMULATOR_TOKEN = 'e2e-simulator-token-keep-private-12345';

export interface DemoJourney {
  journeyId: string;
  contributorToken: string;
  opsToken: string;
  joinCode: string;
  report(seq: number, sM: number): Promise<void>;
  end(): Promise<void>;
}

/** A coordinate at a distance along the committed AC24 line. */
export async function pointAt(request: APIRequestContext, sM: number): Promise<{ lat: number; lon: number }> {
  const response = await request.get(`${API_URL}/v1/routes/${ROUTE_ID}`);
  const route = (await response.json()) as {
    geometry: { coordinates: [number, number][] };
  };
  const line = preparePolyline(route.geometry.coordinates as unknown as LonLat[]);
  const [lon, lat] = interpolateAt(line, sM);
  return { lat, lon };
}

export async function startDemoJourney(request: APIRequestContext): Promise<DemoJourney> {
  const login = await request.post(`${API_URL}/v1/auth/login`, {
    data: { username: 'admin', password: 'admin' },
  });
  if (!login.ok()) throw new Error(`Could not sign in as demo administrator: ${login.status()}`);
  const controller = await login.json() as { token: string };
  const enabled = await request.put(`${API_URL}/v1/demo`, {
    headers: { authorization: `Bearer ${controller.token}` },
    data: { enabled: true },
  });
  if (!enabled.ok()) throw new Error(`Could not enable demo: ${enabled.status()}`);
  const created = await request.post(`${API_URL}/v1/journeys`, {
    headers: { authorization: `Bearer ${TEST_SIMULATOR_TOKEN}` },
    data: { routeId: ROUTE_ID },
  });
  if (!created.ok()) throw new Error(`Could not create demo: ${created.status()}`);
  const body = (await created.json()) as {
    journeyId: string;
    contributorToken: string;
    opsToken: string;
    joinCode: string;
  };

  return {
    ...body,
    async report(seq: number, sM: number) {
      const { lat, lon } = await pointAt(request, sM);
      await request.post(`${API_URL}/v1/journeys/${body.journeyId}/locations`, {
        headers: { authorization: `Bearer ${body.contributorToken}` },
        data: { seq, lat, lon, accuracyM: 12, deviceTs: Date.now(), sampleAgeMs: 0 },
      });
    },
    async end() {
      await request.post(`${API_URL}/v1/journeys/${body.journeyId}/end`, {
        headers: { authorization: `Bearer ${TEST_SIMULATOR_TOKEN}` },
      });
    },
  };
}

/**
 * Point the page at one specific journey.
 *
 * Tests share one API, so several journeys can be live at once and the page's
 * documented preference (real before demo, then newest) may not choose the one
 * this test created. Selecting it explicitly through the ordinary UI control
 * keeps the assertions about that journey.
 */
/**
 * End whatever journey the page's own session is holding.
 *
 * A test that presses "Start a journey" leaves a live journey behind, and the
 * next test would then find it on the map. This reaches for the capability the
 * page is holding in session storage and ends the journey through the ordinary
 * endpoint — the same thing the driver's own control does.
 */
export async function endSessionJourney(
  page: Page,
  request: APIRequestContext,
): Promise<void> {
  const session = await page
    .evaluate(() => window.sessionStorage.getItem('buskothay.contributor'))
    .catch(() => null);
  if (session === null) return;
  try {
    const parsed = JSON.parse(session) as { journeyId?: string };
    const accountRaw = await page.evaluate(() => window.sessionStorage.getItem('buskothay.account'));
    const account = accountRaw ? JSON.parse(accountRaw) as { token?: string } : null;
    if (!parsed.journeyId || !account?.token) return;
    await request.post(`${API_URL}/v1/journeys/${parsed.journeyId}/end`, {
      headers: { authorization: `Bearer ${account.token}` },
    });
  } catch {
    // Best effort: an already-ended journey is exactly the state we wanted.
  }
}

export async function signInAs(
  page: Page,
  request: APIRequestContext,
  role: 'driver' | 'passenger' | 'conductor' = 'driver',
): Promise<void> {
  const session = await register(request, role);
  await page.addInitScript((value) => {
    window.sessionStorage.setItem('buskothay.account', JSON.stringify(value));
  }, session);
}

async function register(request: APIRequestContext, role: 'driver' | 'passenger' | 'conductor') {
  // Keep the useful role prefix while staying below the public 32-character
  // username limit for the longest role names.
  const username = `e2e-${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const response = await request.post(`${API_URL}/v1/auth/register`, {
    data: { username, password: 'correct horse battery staple', role },
  });
  if (!response.ok()) throw new Error(`Could not register test account: ${response.status()}`);
  const body = await response.json() as {
    token: string;
    expiresAtMs: number;
    account: { accountId: string; username: string; role: typeof role; kind: 'community' };
  };
  return body;
}

/**
 * Open the journey sheet.
 *
 * The passenger screen is a full-screen map with a collapsed sheet over it, and
 * the collapsed detail region is `inert` — so the stop list, the journey
 * selector and the route catalogue are deliberately not reachable until it is
 * opened, exactly as they are for a person. Anything asserting on that content
 * opens the sheet first. On a wide screen the drawer already starts open, and
 * this is then a no-op.
 */
export async function expandSheet(page: Page): Promise<void> {
  const toggle = page.locator('.journey-sheet__toggle');
  await toggle.waitFor({ timeout: 15_000 }).catch(() => undefined);
  if ((await toggle.count()) === 0) return;
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

export async function selectJourney(page: Page, journeyId: string): Promise<void> {
  // The journey list is polled, so wait for the page to have picked something up
  // before deciding whether a selector exists at all.
  await page
    .locator('.route-page__panel')
    .getByText(/Demo journey|No bus is sharing|Waiting for the first location/)
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
  await expandSheet(page);

  const selector = page.locator('.journey-selector select');
  if ((await selector.count()) === 0) return;
  const option = selector.locator(`option[value="${journeyId}"]`);
  if ((await option.count()) === 0) return;
  await selector.selectOption(journeyId);
}
