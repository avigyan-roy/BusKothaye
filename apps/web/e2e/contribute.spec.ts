import { expect, test } from '@playwright/test';
import { endSessionJourney, startDemoJourney } from './fixtures.js';

test.describe('contributor page', () => {
  // These tests start real journeys. Leaving them running would put a bus on the
  // passenger map for every test that follows.
  test.afterEach(async ({ page, request }) => {
    await endSessionJourney(page, request);
  });

  test('never asks for location just because the page was opened', async ({ page, context }) => {
    // No permission is granted, and none should be requested.
    let prompted = false;
    await context.grantPermissions([]);
    page.on('dialog', () => {
      prompted = true;
    });

    await page.goto('/drive');
    await expect(page.getByRole('heading', { name: 'Share this journey' })).toBeVisible();
    await expect(page.getByText(/not an official operator feed/i)).toBeVisible();
    expect(prompted).toBe(false);
  });

  test('starting a journey shows a join code and the consent step before any GPS', async ({
    page,
  }) => {
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Start a journey', exact: true }).click();

    await expect(page.getByText(/^BUS-[A-Z0-9]{6}$/)).toBeVisible();
    await expect(page.getByText('Before you start')).toBeVisible();
    await expect(
      page.getByText(/Your location will help estimate this bus journey/),
    ).toBeVisible();
    // Sharing has not begun; the button is an explicit action.
    await expect(page.getByText('Sharing has not started')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start sharing my location' })).toBeVisible();
  });

  test('explains what happens to a contributor’s location data', async ({ page }) => {
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Start a journey', exact: true }).click();
    await page.getByText('What happens to my location?').click();
    await expect(page.getByText(/pseudonymous data, not anonymous data/i)).toBeVisible();
    await expect(page.getByText(/48 hours/)).toBeVisible();
  });

  test('warns that a web page cannot track in the background', async ({ page }) => {
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Start a journey', exact: true }).click();
    await expect(page.getByText(/cannot track location in the background/i)).toBeVisible();
  });

  test('a refused location permission gives a recovery path, not a loop', async ({
    page,
    context,
  }) => {
    // EMULATION. Headless Chromium neither prompts nor reports a refusal — it
    // simply never answers — so the refusal is injected at the browser API. This
    // checks the interface's handling of a refusal; it is not evidence of how a
    // real phone behaves when someone taps "Don't allow".
    await context.clearPermissions();
    await page.addInitScript(() => {
      const denied = {
        code: 1,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: 'User denied Geolocation',
      };
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          watchPosition: (
            _success: PositionCallback,
            error?: PositionErrorCallback | null,
          ) => {
            setTimeout(() => error?.(denied as unknown as GeolocationPositionError), 50);
            return 1;
          },
          clearWatch: () => undefined,
          getCurrentPosition: (
            _success: PositionCallback,
            error?: PositionErrorCallback | null,
          ) => {
            setTimeout(() => error?.(denied as unknown as GeolocationPositionError), 50);
          },
        },
      });
    });

    await page.goto('/drive');
    await page.getByRole('button', { name: 'Start a journey', exact: true }).click();
    await page.getByRole('button', { name: 'Start sharing my location' }).click();

    await expect(page.getByText(/Location permission was refused/i)).toBeVisible({
      timeout: 15_000,
    });
    // The control returns to its starting state rather than re-prompting forever.
    await expect(page.getByRole('button', { name: /Start sharing my location/ })).toBeVisible();
  });

  test('an emulated phone position reaches the passenger map', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    // Emulated geolocation. This is not evidence of real phone behaviour, and
    // the acceptance notes say so.
    await context.setGeolocation({ latitude: 22.5137, longitude: 88.4021 });

    await page.goto('/drive');
    await page.getByRole('button', { name: 'Start a journey', exact: true }).click();
    await page.getByRole('button', { name: 'Start sharing my location' }).click();

    await expect(page.getByText('Sharing your location')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Accepted/).first()).toBeVisible({ timeout: 20_000 });

    // Stopping clears the watcher and the capability.
    await page.getByRole('button', { name: 'Stop sharing' }).click();
    await expect(page.getByRole('button', { name: 'Start a journey', exact: true })).toBeVisible();
  });

  test('ending a journey asks first', async ({ page }) => {
    await page.goto('/drive');
    await page.getByRole('button', { name: 'Start a journey', exact: true }).click();

    await page.getByRole('button', { name: 'End journey', exact: true }).first().click();
    await expect(page.getByText('End this journey?')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('End this journey?')).not.toBeVisible();
  });
});

test.describe('diagnostics', () => {
  test('shows nothing at all without a capability', async ({ page, request }) => {
    const journey = await startDemoJourney(request);
    await journey.report(0, 800);

    await page.goto(`/ops/${journey.journeyId}`);

    await expect(page.getByText(/needs the diagnostics capability/i)).toBeVisible();
    const body = (await page.textContent('body')) ?? '';
    // No source pseudonyms, no positions, no decisions.
    expect(body).not.toMatch(/source-\d/);
    expect(body).not.toMatch(/reputation/i);
    expect(body).not.toContain(journey.opsToken);

    await journey.end();
  });

  test('shows source diagnostics once the ops capability is supplied', async ({
    page,
    request,
  }) => {
    const journey = await startDemoJourney(request);
    await journey.report(0, 800);

    await page.goto(`/ops/${journey.journeyId}`);
    await page.getByLabel('Diagnostics token').fill(journey.opsToken);
    await page.getByRole('button', { name: 'Open diagnostics' }).click();

    await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /source-1/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();

    await journey.end();
  });
});
