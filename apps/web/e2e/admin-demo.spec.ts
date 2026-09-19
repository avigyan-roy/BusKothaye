import { expect, test } from '@playwright/test';
import { API_URL, ROUTE_ID, signInAs } from './fixtures.js';

test.describe('demo administrator access', () => {
  test('the local admin form defaults to admin and can reveal the password without clearing it', async ({
    page,
  }) => {
    await page.goto('/admin');

    await expect(page.getByLabel('Admin username')).toHaveValue('admin');

    const password = page.getByLabel('Admin password');
    const showPassword = page.getByRole('checkbox', { name: 'Show password' });

    await expect(password).toHaveAttribute('type', 'password');
    await password.fill('admin');

    await showPassword.check();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('admin');

    await showPassword.uncheck();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveValue('admin');
  });

  test('admin can sign in with the local development credentials and open the console', async ({
    page,
  }) => {
    await page.goto('/admin');
    await page.getByLabel('Admin username').fill('admin');
    await page.getByLabel('Admin password').fill('admin');
    await page.getByRole('button', { name: 'Open demo console' }).click();

    await expect(page).toHaveURL(/\/demo$/);
    await expect(page.getByRole('heading', { name: 'Demo fleet' })).toBeVisible();
  });

  test('admin can dispatch one AC24 bus from Ruby to Exide at a realistic speed', async ({
    page,
    request,
  }) => {
    test.skip(
      process.env.E2E_FLEET_WORKER !== 'true',
      'Run with E2E_FLEET_WORKER=true to include the persistent worker.',
    );
    await page.goto('/admin');
    await page.getByLabel('Admin password').fill('admin');
    await page.getByRole('button', { name: 'Open demo console' }).click();
    await expect(page.getByRole('heading', { name: 'Dispatch settings' })).toBeVisible();

    await page.getByLabel('Starting checkpoint').selectOption('ruby');
    await page.getByLabel('Destination checkpoint').selectOption('exide');
    await page.getByLabel('Buses').fill('1');
    await page.getByLabel('Sources per bus').fill('1');
    await page.getByLabel('Cruise speed (km/h)').fill('24');
    await page.getByLabel('Loop at the end of the route').uncheck();
    await page.getByRole('button', { name: 'Dispatch demo fleet' }).click();

    await expect(page.getByText('1 active demo buses')).toBeVisible({ timeout: 20_000 });

    let journeyId = '';
    await expect
      .poll(async () => {
        const response = await request.get(`${API_URL}/v1/routes/${ROUTE_ID}/journeys`);
        if (!response.ok()) return false;
        const body = (await response.json()) as {
          journeys: { journeyId: string; isDemo: boolean }[];
        };
        journeyId = body.journeys.find((journey) => journey.isDemo)?.journeyId ?? '';
        return journeyId.length > 0;
      }, { timeout: 20_000 })
      .toBe(true);

    const routeResponse = await request.get(`${API_URL}/v1/routes/${ROUTE_ID}`);
    const route = (await routeResponse.json()) as {
      stops: { id: string; sM: number }[];
    };
    const rubySM = route.stops.find((stop) => stop.id === 'ruby')!.sM;
    await expect
      .poll(async () => {
        const response = await request.get(`${API_URL}/v1/journeys/${journeyId}/state`);
        if (!response.ok()) return null;
        return (await response.json()) as {
          mode: string;
          isDemo: boolean;
          position: { sM: number } | null;
          speedKmh: number | null;
        };
      }, { timeout: 20_000 })
      .toMatchObject({
        isDemo: true,
        position: { sM: expect.any(Number) },
      });

    const stateResponse = await request.get(`${API_URL}/v1/journeys/${journeyId}/state`);
    const state = (await stateResponse.json()) as {
      position: { sM: number };
      speedKmh: number | null;
    };
    // The worker reports immediately at the selected checkpoint, then advances
    // at city speed. Twenty seconds of test latency still keeps it close to Ruby.
    expect(state.position.sM).toBeGreaterThanOrEqual(rubySM - 20);
    expect(state.position.sM).toBeLessThan(rubySM + 250);
    expect(state.speedKmh ?? 0).toBeLessThanOrEqual(30);

    await page.getByRole('button', { name: 'End demo fleet' }).click();
    await expect(page.getByText('0 active demo buses')).toBeVisible({ timeout: 20_000 });
  });

  test('a passenger cannot see or directly open the demo console', async ({ page, request }) => {
    await signInAs(page, request, 'passenger');
    await page.goto('/r/ac24-patuli-howrah');

    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const navigation = page.getByRole('dialog', { name: 'BusKothay navigation' });
    await expect(navigation).toBeVisible();
    await expect(
      navigation.getByRole('link', { name: 'Demo console', exact: true }),
    ).toHaveCount(0);

    await page.goto('/demo');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Demo administrator' })).toBeVisible();
  });

  test('a driver cannot see or directly open the demo console', async ({ page, request }) => {
    await signInAs(page, request, 'driver');
    await page.goto('/r/ac24-patuli-howrah');

    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const navigation = page.getByRole('dialog', { name: 'BusKothay navigation' });
    await expect(navigation.getByRole('link', { name: 'Demo console', exact: true })).toHaveCount(0);

    await page.goto('/demo');
    await expect(page).toHaveURL(/\/admin$/);
  });
});
