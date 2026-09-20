#!/usr/bin/env node
/**
 * Capture the review screenshots listed in docs/TESTING_AND_ACCEPTANCE.md.
 *
 * A build helper, not part of the product. It drives a real browser against a
 * real local API, so what it captures is the application rather than a mock.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const WEB = process.env.WEB_URL ?? 'http://localhost:4174';
const OUT = resolve(process.argv[2] ?? 'apps/web/screenshots');

const VIEWPORTS = [
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'narrow-320x720', width: 320, height: 720 },
  // 640x450 at 200% browser zoom, expressed in the CSS pixels the page sees.
  { name: 'zoom200-320x225', width: 320, height: 225 },
];

const PAGES = [
  { name: 'route', path: '/r/ac24-patuli-howrah' },
  { name: 'drive', path: '/drive' },
  { name: 'ops', path: '/ops/unknown-journey' },
  { name: 'not-found', path: '/nowhere' },
];

// CHROMIUM_PATH lets a machine with a pre-installed browser skip
// `npx playwright install`; everywhere else Playwright finds its own.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
await mkdir(OUT, { recursive: true });

const problems = [];

/**
 * The map screen puts every control over the map, so the two failures worth
 * catching automatically are a control that has drifted off the viewport and a
 * control that has ended up underneath the journey sheet. Both have happened.
 */
const FLOATING = {
  'map actions': '.map-view__actions',
  'top controls': '.route-page__top',
  'map disclosure': '.map-view__disclosure',
  attribution: '.gm-style-cc',
};
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  for (const target of PAGES) {
    await page.goto(`${WEB}${target.path}`, { waitUntil: 'networkidle' });
    // Give the map a moment to settle; a screenshot of a half-drawn map is not a
    // useful review artefact.
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: `${OUT}/${target.name}-${viewport.name}.png`,
      fullPage: false,
    });

    // Horizontal overflow is the failure this check exists for.
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    if (scrollWidth > viewport.width + 1) {
      problems.push(`${target.name} at ${viewport.name}: scrollWidth ${scrollWidth}`);
    }

    const boxes = await page.evaluate((selectors) => {
      const read = (selector) => {
        const element = document.querySelector(selector);
        if (element === null) return null;
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      const result = { sheet: read('.journey-sheet') };
      for (const [name, selector] of Object.entries(selectors)) result[name] = read(selector);
      return result;
    }, FLOATING);

    const sheet = boxes.sheet;
    for (const name of Object.keys(FLOATING)) {
      const box = boxes[name];
      if (box === null || box.width === 0 || box.height === 0) continue;
      if (
        box.top < -1 ||
        box.left < -1 ||
        box.right > viewport.width + 1 ||
        box.bottom > viewport.height + 1
      ) {
        problems.push(
          `${target.name} at ${viewport.name}: ${name} is outside the viewport`,
        );
      }
      if (
        sheet !== null &&
        box.left < sheet.right - 1 &&
        box.right > sheet.left + 1 &&
        box.top < sheet.bottom - 1 &&
        box.bottom > sheet.top + 1
      ) {
        problems.push(`${target.name} at ${viewport.name}: ${name} overlaps the journey sheet`);
      }
    }
  }
  await context.close();
}

await browser.close();

console.log(`Screenshots written to ${OUT}`);
if (problems.length > 0) {
  console.error('Layout problems detected:');
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('No page overflow, off-screen control or sheet collision at any captured width.');
