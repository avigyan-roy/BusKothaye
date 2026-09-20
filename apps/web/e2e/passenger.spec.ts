import { expect, test } from '@playwright/test';
import { openDetailsPane, selectJourney, startDemoJourney, withStop } from './fixtures.js';

const ROUTE = '/r/ac24-patuli-howrah';
const CHECKPOINTS = ['Patuli', 'Ruby', 'Gariahat', 'Hazra', 'Exide', 'Park Street', 'Esplanade', 'Howrah'];

test.describe('finding a bus', () => {
  test('opens on the stop-and-route finder with both search paths', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'I know where I’m going' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'I know which bus I want' })).toBeVisible();
    // The route chips come from the API, not from the bundle.
    await expect(page.getByRole('button', { name: 'AC24', exact: true })).toBeVisible();
  });

  test('picks a stop from the server directory and remembers it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Choose a stop' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /Gariahat/ }).click();
    await expect(page.getByRole('heading', { name: 'Gariahat' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Gariahat' })).toBeVisible();
  });

  test('start and end stops produce a departure board with a clock time', async ({
    page,
    request,
  }) => {
    const journey = await startDemoJourney(request);
    await journey.report(0, 500);

    await page.goto('/find?from=gariahat&to=howrah');
    await expect(page.getByRole('heading', { name: 'Gariahat → Howrah' })).toBeVisible();
    await expect(page.locator('.bus-result').first()).toBeVisible({ timeout: 20_000 });
    // A single 24-hour clock time, never a range and never a 12-hour one.
    const clock = page.locator('.bus-result__eta-clock').first();
    await expect(clock).toHaveText(/^\d{2}:\d{2}$/, { timeout: 20_000 });
    await expect(page.getByText(/AM|PM/)).toHaveCount(0);

    await journey.end();
  });

  test('finds the independently authored inbound route for a reverse journey', async ({ page }) => {
    await page.goto('/find?from=howrah&to=esplanade');
    // This used to be an empty-state check before the real inbound fixture was
    // added. It now proves the browser consumes that second route record rather
    // than reversing the outbound line or claiming there is no service.
    await expect(page.getByRole('heading', { name: 'Howrah → Esplanade' })).toBeVisible();
    await expect(page.locator('.bus-result')).toHaveCount(1);
    await expect(page.locator('.bus-result').getByText('Towards Patuli')).toBeVisible();
  });

  test('a route leads to its directions and then to one arrival time', async ({
    page,
    request,
  }) => {
    const journey = await startDemoJourney(request);
    await journey.report(0, 500);

    await withStop(page, 'gariahat');
    await page.goto('/');
    await page.getByRole('button', { name: 'AC24', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Which way is your bus going?' })).toBeVisible();
    await page.getByRole('link', { name: /Towards Howrah/ }).click();

    await expect(page.getByText('Arriving at Gariahat')).toBeVisible();
    await expect(page.locator('.arrival-clock__value')).toHaveText(/^\d{2}:\d{2}$/, {
      timeout: 20_000,
    });

    await journey.end();
  });

  test('the other direction is a different route record, not a mirror', async ({ page }) => {
    await page.goto('/bus/AC24?stop=gariahat');
    const towards = page.locator('.direction-option__main');
    await expect(towards).toHaveText(['Towards Howrah', 'Towards Patuli']);
  });
});

test.describe('the details screen', () => {
  test('shows the route, its stops and the map without any journey', async ({ page }) => {
    await page.goto(ROUTE);
    await openDetailsPane(page);

    for (const name of CHECKPOINTS) {
      await expect(page.getByRole('button', { name: new RegExp(name) }).first()).toBeVisible();
    }
    await expect(page.locator('.map-view__canvas')).toBeVisible();
    // Routine CI has no billable Amazon Location credential. It verifies the
    // intentional fallback; a deployment smoke test covers AWS-rendered tiles.
    await expect(page.getByText(/Amazon Location is not configured/)).toBeVisible();
  });

  test('never shows an arrival it does not have evidence for', async ({ page }) => {
    await page.goto(ROUTE);
    await openDetailsPane(page);

    const empty = page.getByText('No bus is sharing its location right now.');
    const waiting = page.getByText('Waiting for the first location.');
    const demo = page.locator('.demo-badge');
    await expect(empty.or(waiting).or(demo).first()).toBeVisible();

    if (await empty.isVisible().catch(() => false)) {
      // Every timeline row must read as unknown, with no invented time.
      await expect(page.locator('.timeline-row.is-unknown').first()).toBeVisible();
      await expect(page.locator('.timeline-row.is-passed')).toHaveCount(0);
      await expect(page.locator('.arrival-clock__value')).toHaveText('--:--');
    }
  });

  test('discloses that the route geometry is approximate', async ({ page }) => {
    await page.goto(ROUTE);
    await page.getByText('About this route').click();
    await expect(page.getByText(/approximation of the corridor/i).first()).toBeVisible();
  });

  test('selecting a stop updates the panel and the shareable link', async ({ page, request }) => {
    const journey = await startDemoJourney(request);
    await journey.report(0, 1000);

    await page.goto(ROUTE);
    await selectJourney(page, journey.journeyId);
    await page.getByRole('button', { name: /Gariahat/ }).first().click();

    await expect(page).toHaveURL(/\?stop=gariahat/);
    await expect(page.locator('.selected-stop__name')).toHaveText('Gariahat');
    // The link carries the stop and nothing else.
    expect(page.url()).not.toMatch(/token|code|journey=/i);

    await journey.end();
  });

  test('a deep link with a stop reloads directly after a static build', async ({
    page,
    request,
  }) => {
    const journey = await startDemoJourney(request);
    await journey.report(0, 1000);

    await page.goto(`${ROUTE}?stop=hazra`);
    await expect(page.locator('.selected-stop__name')).toHaveText('Hazra');

    await page.reload();
    await expect(page.locator('.selected-stop__name')).toHaveText('Hazra');

    await journey.end();
  });

  test('keeps the chosen stop visible when no bus is running', async ({ page }) => {
    await page.goto(`${ROUTE}?stop=hazra`);
    await openDetailsPane(page);
    await expect(page.locator('.timeline-row.is-selected .timeline-row__name')).toContainText(
      'Hazra',
    );
    await expect(page.locator('.timeline-row__tag')).toHaveText('Your stop');
  });

  test('shows the bus, a live clock time and green/amber/red progress', async ({
    page,
    request,
  }) => {
    const journey = await startDemoJourney(request);
    // Behind Gariahat, so Patuli and Ruby are behind the bus and the rest ahead.
    await journey.report(0, 6000);

    await page.goto(`${ROUTE}?stop=esplanade`);
    await selectJourney(page, journey.journeyId);

    await expect(page.locator('.live-status.is-live .live-status__label')).toHaveText('Live', {
      timeout: 20_000,
    });
    await expect(page.locator('.arrival-clock__value')).toHaveText(/^\d{2}:\d{2}$/, {
      timeout: 20_000,
    });
    await expect(page.locator('.timeline-row.is-passed').first()).toBeVisible();
    await expect(page.locator('.timeline-row.is-approaching')).toHaveCount(1);
    // The live indicator pulses only where the bus actually is.
    expect(await page.locator('.timeline-row__pulse').count()).toBeLessThanOrEqual(1);

    await journey.end();
  });

  test('freezes and admits the position is out of date when reports stop', async ({
    page,
    request,
  }) => {
    test.slow(); // This one waits out the real 90 second horizon.
    const journey = await startDemoJourney(request);
    await journey.report(0, 900);

    await page.goto(`${ROUTE}?stop=ruby`);
    await selectJourney(page, journey.journeyId);
    const label = page.locator('.live-status__label');
    await expect(label).toHaveText('Live', { timeout: 20_000 });

    // Nothing more is reported. The state must degrade on its own, locally,
    // without a single further byte from the server changing the answer.
    await expect(label).toHaveText('Position may be old', { timeout: 25_000 });
    await expect(label).toHaveText('Out of date', { timeout: 110_000 });
    await expect(page.getByText(/Arrival time is unavailable/i).first()).toBeVisible();

    await journey.end();
  });

  test('never scrolls sideways', async ({ page }) => {
    await page.goto(ROUTE);
    await openDetailsPane(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('a stop can be chosen with the keyboard alone', async ({ page }) => {
    await page.goto(ROUTE);
    await openDetailsPane(page);
    const esplanade = page.getByRole('button', { name: /Esplanade/ }).first();
    await esplanade.focus();
    await expect(esplanade).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?stop=esplanade/);
  });
});

test.describe('theme', () => {
  test('switches, and survives navigation and a reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.goto(ROUTE);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('not found', () => {
  test('gives a useful screen and a way back', async ({ page }) => {
    await page.goto('/nowhere-at-all');
    await expect(page.getByText('That page does not exist')).toBeVisible();
    await page.getByRole('link', { name: /Find your bus/ }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
