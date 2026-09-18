#!/usr/bin/env node
/**
 * Validate every committed route fixture.
 *
 * Run by `npm run routes:validate` and by CI. It prints what it measured so that
 * a geometry edit shows up as a distance change in the diff of a CI log, not as a
 * silent shift in everybody's arrival times.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { prepareRoute, RouteValidationError } from '@buskothay/shared';

const routeDir = resolve(process.argv[2] ?? 'data/routes');

function formatKm(metres) {
  return `${(metres / 1000).toFixed(2)} km`;
}

async function main() {
  const entries = (await readdir(routeDir)).filter((name) => name.endsWith('.json'));
  if (entries.length === 0) {
    console.error(`No route fixtures found in ${routeDir}`);
    process.exit(1);
  }

  let failed = 0;
  for (const entry of entries.sort()) {
    const path = join(routeDir, entry);
    const raw = JSON.parse(await readFile(path, 'utf8'));
    try {
      const { dto, line } = prepareRoute(raw);
      console.log(`\n${entry}`);
      console.log(`  ${dto.code} ${dto.origin} → ${dto.destination} (${dto.direction})`);
      console.log(`  version ${dto.version}, ${line.points.length} points, ${formatKm(dto.lengthM)}`);
      console.log(
        `  geometry: ${dto.provenance.isApproximateGeometry ? 'APPROXIMATE — must be disclosed in the UI' : 'verified'}`,
      );
      console.log(
        `  schedule: ${dto.schedule === null ? 'none (delay stays null)' : dto.schedule.isIllustrative ? 'illustrative only' : dto.schedule.source}`,
      );
      console.log('  checkpoints:');
      for (const stop of dto.stops) {
        console.log(`    ${stop.sM.toFixed(0).padStart(6)} m  ${stop.name}`);
      }
      console.log('  segments:');
      for (const segment of dto.segments) {
        const km = (segment.toSM - segment.fromSM) / 1000;
        const kmh = segment.typicalSpeedMps * 3.6;
        console.log(
          `    ${segment.fromSM.toFixed(0).padStart(6)}–${segment.toSM.toFixed(0).padStart(6)} m  ` +
            `${km.toFixed(2)} km at ${kmh.toFixed(0)} km/h, dwell ${segment.dwellAllowanceS}s`,
        );
      }
    } catch (error) {
      failed += 1;
      console.error(`\n${entry}: FAILED`);
      if (error instanceof RouteValidationError) {
        for (const problem of error.problems) console.error(`  - ${problem}`);
      } else {
        console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} route fixture(s) failed validation.`);
    process.exit(1);
  }
  console.log(`\n${entries.length} route fixture(s) validated.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
