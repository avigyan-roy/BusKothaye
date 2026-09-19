import { expect, test } from '@playwright/test';
import {
  API_URL,
  ROUTE_ID,
  selectJourney,
  signInAs,
  startDemoJourney,
} from './fixtures.js';

test.describe('passenger boarding session', () => {
  test('keeps the boarding stop and can be cleared after the journey ends', async ({
    page,
    request,
  }) => {
    const routeResponse = await request.get(`${API_URL}/v1/routes/${ROUTE_ID}`);
    expect(routeResponse.ok()).toBe(true);
    const route = (await routeResponse.json()) as {
      stops: { id: string; name: string; sM: number }[];
    };
    const ruby = route.stops.find((stop) => stop.id === 'ruby');
    expect(ruby, 'Ruby should remain a checkpoint on AC24').toBeDefined();

    const journey = await startDemoJourney(request);
    try {
      await journey.report(0, ruby!.sM);
      await signInAs(page, request, 'passenger');
      await page.goto(`/r/${ROUTE_ID}?stop=ruby`);
      await selectJourney(page, journey.journeyId);

      await expect(page.getByRole('button', { name: 'I boarded this bus' })).toBeVisible({
        timeout: 20_000,
      });
      await page.getByRole('button', { name: 'I boarded this bus' }).click();
      await expect(page.getByText('Boarded at Ruby')).toBeVisible();

      await page.getByRole('button', { name: /Gariahat/ }).first().click();
      await expect(page).toHaveURL(/stop=gariahat/);
      await expect(page.getByText('Boarded at Ruby')).toBeVisible();

      await journey.end();
      await expect(page.getByText('This journey has ended. Location sharing is off.')).toBeVisible({
        timeout: 20_000,
      });

      await page.getByRole('button', { name: 'I got off' }).click();
      await expect(page.getByRole('heading', { name: 'You’re aboard' })).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => window.sessionStorage.getItem('buskothay.contributor')))
        .toBeNull();
    } finally {
      await journey.end();
    }
  });
});
