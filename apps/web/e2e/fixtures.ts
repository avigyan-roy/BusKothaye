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
  const created = await request.post(`${API_URL}/v1/journeys`, {
    data: { routeId: ROUTE_ID, isDemo: true },
  });
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
        headers: { authorization: `Bearer ${body.contributorToken}` },
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
    const parsed = JSON.parse(session) as { journeyId?: string; token?: string };
    if (!parsed.journeyId || !parsed.token) return;
    await request.post(`${API_URL}/v1/journeys/${parsed.journeyId}/end`, {
      headers: { authorization: `Bearer ${parsed.token}` },
    });
  } catch {
    // Best effort: an already-ended journey is exactly the state we wanted.
  }
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

  const selector = page.locator('.journey-selector select');
  if ((await selector.count()) === 0) return;
  const option = selector.locator(`option[value="${journeyId}"]`);
  if ((await option.count()) === 0) return;
  await selector.selectOption(journeyId);
}
