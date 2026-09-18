import { expect, test } from '@playwright/test';
import { selectJourney, startDemoJourney } from './fixtures.js';

test.describe('passenger map', () => {
  test('opening the site lands on the route, not a marketing page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/r\/ac24-patuli-howrah/);
    await expect(page.locator('.route-badge')).toHaveText('AC24');
    await expect(page.getByText('Patuli → Howrah').first()).toBeVisible();
  });

  test('shows the route, its stops and the map without any journey', async ({ page }) => {
    await page.goto('/r/ac24-patuli-howrah');

    // Every checkpoint is listed, with no invented arrival times.
    for (const name of ['Patuli', 'Ruby', 'Gariahat', 'Hazra', 'Exide', 'Park Street', 'Esplanade', 'Howrah']) {
      await expect(page.getByRole('button', { name: new RegExp(name) }).first()).toBeVisible();
    }
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    // The attribution control is present and is never positioned off-screen or
    // covered. It renders empty here only because the test basemap is the local
    // fixture, which has nothing to attribute; with a real basemap it carries the
    // provider's credit, and the controls are laid out to clear it.
    await expect(page.locator('.maplibregl-ctrl-attrib')).toBeAttached();
    const attribution = await page.locator('.maplibregl-ctrl-attrib').boundingBox();
    const viewport = page.viewportSize();
    if (attribution !== null && viewport !== null) {
      expect(attribution.x).toBeGreaterThanOrEqual(0);
      expect(attribution.x + attribution.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  test('never shows a bus it does not have evidence for', async ({ page }) => {
    await page.goto('/r/ac24-patuli-howrah');

    // Other tests share this API, so one of three honest states will be showing.
    // What must never appear is an arrival time with no journey behind it.
    const empty = page.getByText('No bus is sharing its location right now.');
    const waiting = page.getByText('Waiting for the first location.');
    const demo = page.locator('.route-page__demo');
    await expect(empty.or(waiting).or(demo).first()).toBeVisible();

    if (await empty.isVisible().catch(() => false)) {
      await expect(page.getByText(/\bmin\b/)).toHaveCount(0);
    }
  });

  test('discloses that the route geometry is approximate', async ({ page }) => {
    await page.goto('/r/ac24-patuli-howrah');
    await expect(page.getByText(/approximation of the corridor/i).first()).toBeVisible();
  });

  test('selecting a stop updates the panel and the shareable link', async ({
    page,
    request,
  }) => {
    // The arrival panel only exists when a journey does — with no bus there is
    // nothing to give an arrival for, and the empty state takes its place. So
    // this test provides its own journey rather than depending on another one
    // having left one behind.
    const journey = await startDemoJourney(request);
    await journey.report(0, 1000);

    await page.goto('/r/ac24-patuli-howrah');
    await selectJourney(page, journey.journeyId);

    await page.getByRole('button', { name: /Gariahat/ }).first().click();

    await expect(page).toHaveURL(/\?stop=gariahat/);
    await expect(page.getByRole('heading', { name: 'Gariahat' })).toBeVisible();

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

    await page.goto('/r/ac24-patuli-howrah?stop=hazra');
    await selectJourney(page, journey.journeyId);
    await expect(page.getByRole('heading', { name: 'Hazra' })).toBeVisible();

    // The point of the test: a direct URL still works after a static build,
    // which is what the SPA rewrite has to get right in production.
    await page.reload();
    await selectJourney(page, journey.journeyId);
    await expect(page.getByRole('heading', { name: 'Hazra' })).toBeVisible();

    await journey.end();
  });

  test('the stop list still shows the selection when no bus is running', async ({ page }) => {
    // With no journey there is no arrival to give, but the person's chosen stop
    // must not silently disappear.
    await page.goto('/r/ac24-patuli-howrah?stop=hazra');
    await expect(
      page.getByRole('button', { name: /Hazra.*Selected stop/s }).first(),
    ).toBeVisible();
  });

  test('shows a bus and a live arrival once a journey reports', async ({ page, request }) => {
    const journey = await startDemoJourney(request);
    await journey.report(0, 1200);

    await page.goto('/r/ac24-patuli-howrah?stop=ruby');
    await selectJourney(page, journey.journeyId);

    await expect(page.locator('.route-page__demo')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.status-badge__label')).toHaveText('Live');
    // An arrival appears only because the API supplied one.
    await expect(page.getByText(/\d+(–\d+)?\s*min/).first()).toBeVisible();

    await journey.end();
  });

  test('freezes and admits the position is out of date when reports stop', async ({
    page,
    request,
  }) => {
    test.slow(); // This one waits out the real 90 second horizon.
    const journey = await startDemoJourney(request);
    await journey.report(0, 900);

    await page.goto('/r/ac24-patuli-howrah?stop=ruby');
    await selectJourney(page, journey.journeyId);
    const badge = page.locator('.status-badge__label');
    await expect(badge).toHaveText('Live', { timeout: 20_000 });

    // Nothing more is reported. The badge must degrade on its own, locally,
    // without a single further byte from the server changing the answer.
    await expect(badge).toHaveText('Estimated', { timeout: 25_000 });
    await expect(badge).toHaveText('Out of date', { timeout: 110_000 });
    await expect(page.getByText(/Arrival time is unavailable/i).first()).toBeVisible();

    await journey.end();
  });

  test('keeps the textual view usable and never scrolls sideways', async ({ page }) => {
    await page.goto('/r/ac24-patuli-howrah');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('a stop can be chosen with the keyboard alone', async ({ page }) => {
    await page.goto('/r/ac24-patuli-howrah');
    const esplanade = page.getByRole('button', { name: /Esplanade/ }).first();
    await esplanade.focus();
    await expect(esplanade).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?stop=esplanade/);
  });
});

test.describe('not found', () => {
  test('gives a useful screen and a way back to the route', async ({ page }) => {
    await page.goto('/nowhere-at-all');
    await expect(page.getByText('That page does not exist')).toBeVisible();
    await page.getByRole('link', { name: /AC24 map/ }).click();
    await expect(page).toHaveURL(/\/r\/ac24-patuli-howrah/);
  });
});
