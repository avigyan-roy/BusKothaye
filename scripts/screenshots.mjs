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

const overflow = [];
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
      overflow.push(`${target.name} at ${viewport.name}: scrollWidth ${scrollWidth}`);
    }
  }
  await context.close();
}

await browser.close();

console.log(`Screenshots written to ${OUT}`);
if (overflow.length > 0) {
  console.error('Horizontal overflow detected:');
  for (const line of overflow) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('No horizontal page overflow at any captured width.');
