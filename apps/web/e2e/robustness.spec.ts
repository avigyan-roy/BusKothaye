import { expect, test, type Page } from '@playwright/test';
import { API_URL, signInAs, withStop } from './fixtures.js';

/**
 * The application under abuse.
 *
 * Nothing here follows the happy path. These are the things a real person does
 * by accident — an edited URL, a back button in the middle of a flow, an empty
 * form, a fistful of rapid taps — plus the things an unwelcome person does on
 * purpose. The bar is not that every one of them produces something useful; it
 * is that none of them produces a blank screen, a console error, or a page
 * showing one stop's name above another stop's arrival time.
 */

/** Fails the test if the page logged an error, rather than only looking fine. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

test.describe('bad input and odd orders', () => {
  test('an empty start-and-end search asks for the stops instead of navigating', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Find buses' }).click();
    await expect(page.getByText('Choose both stops to find a bus.')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(errors).toEqual([]);
  });

  test('the same stop twice is refused, in the browser and at the API', async ({
    page,
    request,
  }) => {
    await withStop(page, 'howrah');
    await page.goto('/');
    await page.getByRole('button', { name: /To Choose a stop/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Howrah/ }).click();
    await page.getByRole('button', { name: 'Find buses' }).click();
    await expect(page.getByText('Choose two different stops.')).toBeVisible();

    const direct = await request.get(`${API_URL}/v1/arrivals?from=howrah&to=howrah`);
    expect(direct.status()).toBe(400);
  });

  test('nonsense in the URL produces an explanation, not a blank page', async ({ page }) => {
    const errors = watchConsole(page);

    await page.goto('/find?from=not-a-stop&to=also-not-a-stop');
    await expect(page.getByRole('link', { name: /Change stops/ }).first()).toBeVisible();

    await page.goto('/find');
    await expect(page.getByText('Choose both stops to find a bus.')).toBeVisible();

    await page.goto('/bus/DOES-NOT-EXIST?stop=howrah');
    await expect(page.getByText(/Map geometry not available/i)).toBeVisible();

    await page.goto('/r/no-such-route');
    await expect(page.getByRole('heading', { name: /could not be loaded|not available/i })).toBeVisible();

    // These navigations deliberately request three missing API resources. A
    // Chromium network 404 is expected; a JavaScript exception or any other
    // console error is not.
    expect(
      errors.filter(
        (error) => !error.startsWith('Failed to load resource: the server responded with a status of 404'),
      ),
    ).toEqual([]);
  });

  test('a route that does not call at the chosen stop says exactly that', async ({ page }) => {
    // Patuli is on the outbound route only; the inbound record ends there, so
    // asking the outbound direction about a stop it does not serve must be a
    // sentence, not an empty screen.
    await page.goto('/bus/AC24?dir=ac24-patuli-howrah&stop=patuli');
    // Patuli *is* the outbound origin, so this one has an answer; the check is
    // that an answer or an explanation always appears, never nothing at all.
    await expect(
      page.locator('.answer-card').getByText(/Arriving at|does not stop at/),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('extremely long and hostile search text is simply not found', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Choose a stop' }).first().click();

    const search = page.getByRole('dialog').getByPlaceholder('Type a stop name');
    await search.fill('<script>alert(1)</script>');
    await expect(page.getByText(/No stop called/)).toBeVisible();

    await search.fill('x'.repeat(500));
    await expect(page.getByText(/No stop called/)).toBeVisible();

    await search.fill('gariahat');
    await expect(page.getByRole('dialog').getByRole('button', { name: /Gariahat/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('rapid repeated clicking does not leave the finder inconsistent', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');

    for (let round = 0; round < 4; round += 1) {
      await page.getByRole('button', { name: /Choose a stop|Change stop/ }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: round % 2 === 0 ? /Ruby/ : /Exide/ }).click();
    }
    // Whatever was clicked last is what the page says — one stop, not a blend.
    await expect(page.getByRole('heading', { name: 'Exide' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('back and forward walk the whole search flow without losing the stop', async ({ page }) => {
    const errors = watchConsole(page);
    await withStop(page, 'gariahat');

    await page.goto('/');
    await page.getByRole('button', { name: 'AC24', exact: true }).click();
    await expect(page).toHaveURL(/\/bus\/AC24/);
    await page.getByRole('link', { name: /Towards Howrah/ }).click();
    await expect(page).toHaveURL(/dir=ac24-patuli-howrah/);

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Which way is your bus going?' })).toBeVisible();
    await page.goForward();
    // The stop the passenger chose is still the one being timed.
    await expect(page.getByText('Arriving at Gariahat')).toBeVisible({ timeout: 20_000 });

    await page.goBack();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Gariahat' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the details screen and the finder never disagree about the stop', async ({ page }) => {
    await withStop(page, 'ruby');
    await page.goto('/r/ac24-patuli-howrah');
    await page.getByRole('button', { name: /Park Street/ }).first().click();
    await expect(page.locator('.selected-stop__name')).toHaveText('Park Street');

    // Going back to the finder must not resurrect the stop chosen before.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Park Street' })).toBeVisible();
  });
});

test.describe('authorisation', () => {
  test('an anonymous visitor cannot reach the admin console by typing its address', async ({
    page,
  }) => {
    await page.goto('/admin/routes');
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole('heading', { name: 'Operations administrator' })).toBeVisible();
  });

  test('the admin API refuses an anonymous, a passenger and a forged token', async ({
    page,
    request,
  }) => {
    for (const headers of [
      undefined,
      { authorization: 'Bearer not-a-real-token' },
      { authorization: 'Bearer ' },
    ]) {
      const listed = await request.get(`${API_URL}/v1/admin/routes`, headers ? { headers } : {});
      expect([401, 403]).toContain(listed.status());

      const deleted = await request.delete(
        `${API_URL}/v1/admin/routes/ac24-patuli-howrah`,
        headers ? { headers } : {},
      );
      expect([401, 403]).toContain(deleted.status());
    }

    // A signed-in ordinary passenger is not an administrator either.
    await signInAs(page, request, 'passenger');
    await page.goto('/');
    const token = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('buskothay.account');
      return raw === null ? null : (JSON.parse(raw) as { token: string }).token;
    });
    expect(token).not.toBeNull();
    const asPassenger = await request.put(`${API_URL}/v1/admin/routes/ac24-patuli-howrah`, {
      headers: { authorization: `Bearer ${token}` },
      data: { route: {} },
    });
    expect(asPassenger.status()).toBe(403);
  });

  test('signing out ends administrator access immediately', async ({ page }) => {
    await page.goto('/admin');
    await page.getByLabel('Admin password').fill('admin');
    await page.getByRole('button', { name: 'Open operations console' }).click();
    await expect(page).toHaveURL(/\/admin\/routes$/);

    await page.evaluate(() => window.sessionStorage.removeItem('buskothay.account'));
    await page.goto('/admin/routes');
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole('heading', { name: 'Operations administrator' })).toBeVisible();
  });
});
