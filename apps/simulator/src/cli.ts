#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { ApiClient, SimulatorApiError } from './client.js';
import { renderChartSvg } from './chart.js';
import { runScenario, type Sample } from './runner.js';
import { ScenarioSchema, type Scenario } from './scenario.js';
import { buildScorecard, type Scorecard } from './scorecard.js';

/**
 * `npm run simulate -- --scenario happy-multi --api http://localhost:3001`
 *
 * A command-line tool, not a hidden backend endpoint: it creates its own demo
 * journey, joins its own contributors, reports through the public API, reads the
 * public state, and ends what it started. Nothing it does is unavailable to a
 * contributor with a browser.
 */

interface Options {
  scenario: string | null;
  api: string;
  out: string;
  scenarioDir: string;
  timeScale: number;
  list: boolean;
  seed: number | null;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    scenario: null,
    api: 'http://localhost:3001',
    out: 'apps/simulator/out',
    scenarioDir: 'apps/simulator/scenarios',
    timeScale: 1,
    list: false,
    seed: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const value = argv[i + 1];
    switch (arg) {
      case '--scenario':
        options.scenario = value ?? null;
        i += 1;
        break;
      case '--api':
        if (value) options.api = value.replace(/\/$/, '');
        i += 1;
        break;
      case '--out':
        if (value) options.out = value;
        i += 1;
        break;
      case '--scenarios':
        if (value) options.scenarioDir = value;
        i += 1;
        break;
      case '--timeScale':
        options.timeScale = Number(value);
        i += 1;
        break;
      case '--seed':
        options.seed = Number(value);
        i += 1;
        break;
      case '--list':
        options.list = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        break;
    }
  }
  return options;
}

function printUsage(): void {
  process.stdout.write(
    [
      'BusKothay simulator',
      '',
      'Usage:',
      '  npm run simulate -- --scenario <name> [--api <url>] [--out <dir>] [--seed <n>]',
      '  npm run simulate -- --list',
      '',
      'Options:',
      '  --scenario <name>  Scenario to run, or "all" for the whole library',
      '  --api <url>        API base URL (default http://localhost:3001)',
      '  --out <dir>        Where results are written (default apps/simulator/out)',
      '  --scenarios <dir>  Scenario directory (default apps/simulator/scenarios)',
      '  --seed <n>         Override the scenario seed',
      '  --timeScale <n>    Must be 1. Real time is the only honest scale over HTTP.',
      '  --list             List the available scenarios and exit',
      '',
    ].join('\n'),
  );
}

async function loadScenarios(dir: string): Promise<Scenario[]> {
  const path = resolve(dir);
  const files = (await readdir(path)).filter((f) => f.endsWith('.json'));
  const scenarios: Scenario[] = [];
  for (const file of files.sort()) {
    const raw = JSON.parse(await readFile(join(path, file), 'utf8')) as unknown;
    scenarios.push(ScenarioSchema.parse(raw));
  }
  return scenarios;
}

function toCsv(samples: readonly Sample[]): string {
  const header = 'tS,mode,truthSM,estimateSM,errorM,confidenceM,passedStopCount';
  const rows = samples.map((s) =>
    [
      s.tS.toFixed(2),
      s.mode,
      s.truthSM.toFixed(1),
      s.estimateSM === null ? '' : s.estimateSM.toFixed(1),
      s.errorM === null ? '' : s.errorM.toFixed(1),
      s.confidenceM === null ? '' : s.confidenceM.toFixed(1),
      String(s.passedStopCount),
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

function formatMetric(value: number | null, unit: string, digits = 0): string {
  return value === null ? 'not measured' : `${value.toFixed(digits)}${unit}`;
}

function printScorecard(card: Scorecard): void {
  const lines = [
    '',
    `Scenario: ${card.scenario}  (seed ${card.seed}, ${card.durationS}s, journey ${card.journeyId})`,
    `  samples                ${card.sampleCount} (${card.liveSampleCount} while tracking)`,
    `  live error p50 / p95   ${formatMetric(card.liveP50ErrorM, ' m')} / ${formatMetric(card.liveP95ErrorM, ' m')}`,
    `  blackout max error     ${formatMetric(card.blackoutMaxErrorM, ' m')}`,
    `  recovery               ${formatMetric(card.recoverySeconds, ' s', 1)}`,
    `  spoof rejection        ${card.spoofRejectionRate === null ? 'no dishonest source' : `${(card.spoofRejectionRate * 100).toFixed(0)}%`}`,
    `  false rejection        ${card.falseRejectionRate === null ? 'not measured' : `${(card.falseRejectionRate * 100).toFixed(1)}%`}`,
    `  confidence coverage    ${card.confidenceCoverage === null ? 'not measured' : `${(card.confidenceCoverage * 100).toFixed(0)}% of live samples inside the published accuracy`}`,
    `  result                 ${card.passed ? 'PASS' : 'FAIL'}`,
  ];
  for (const failure of card.failures) lines.push(`    - ${failure}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.timeScale !== 1) {
    process.stderr.write(
      'timeScale must be 1. An HTTP scenario cannot accelerate the server clock, so a\n' +
        'compressed run would not measure real-time behaviour. Use the pure-engine tests\n' +
        '(npm test) for fast time travel, or write a shorter scenario.\n',
    );
    process.exit(2);
  }

  const scenarios = await loadScenarios(options.scenarioDir);

  if (options.list || options.scenario === null) {
    process.stdout.write('Available scenarios:\n');
    for (const scenario of scenarios) {
      process.stdout.write(
        `  ${scenario.name.padEnd(22)} ${scenario.durationS}s  ${scenario.description}\n`,
      );
    }
    if (options.scenario === null && !options.list) {
      process.stdout.write('\nPick one with --scenario <name>, or "all".\n');
      process.exit(2);
    }
    process.exit(0);
  }

  const selected =
    options.scenario === 'all'
      ? scenarios
      : scenarios.filter((s) => s.name === options.scenario);

  if (selected.length === 0) {
    process.stderr.write(`No scenario named "${options.scenario}".\n`);
    process.exit(2);
  }

  const api = new ApiClient(options.api, process.env.SIMULATOR_TOKEN);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });

  const cards: Scorecard[] = [];
  for (const base of selected) {
    const scenario = options.seed === null ? base : { ...base, seed: options.seed };
    process.stdout.write(`\n▸ ${scenario.name}: ${scenario.description}\n`);
    process.stdout.write(`  running for ${scenario.durationS}s at real speed…\n`);

    const run = await runScenario(scenario, api, (line) => process.stdout.write(`  ${line}\n`));
    const card = buildScorecard(run);
    cards.push(card);

    await writeFile(
      join(outDir, `${scenario.name}.json`),
      `${JSON.stringify({ scorecard: card, scenario, samples: run.samples }, null, 2)}\n`,
    );
    await writeFile(join(outDir, `${scenario.name}.csv`), `${toCsv(run.samples)}\n`);
    await writeFile(
      join(outDir, `${scenario.name}.svg`),
      `${renderChartSvg(run.samples, `${scenario.name} — true position against estimate`)}\n`,
    );

    printScorecard(card);
  }

  const failed = cards.filter((c) => !c.passed);
  process.stdout.write(
    `\n${cards.length - failed.length}/${cards.length} scenario(s) met their declared expectations. Results in ${outDir}\n`,
  );
  // A missed expectation fails the command. A scorecard that always passes is not
  // a measurement.
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  // A connection failure is a setup problem, not a bug to read a stack trace
  // about; say what to do instead.
  if (error instanceof SimulatorApiError && error.code === 'UNREACHABLE') {
    process.stderr.write(`\n${error.message}\n\n`);
    process.exit(3);
  }
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
