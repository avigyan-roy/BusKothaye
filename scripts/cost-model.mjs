#!/usr/bin/env node
/**
 * BusKothay 30-day AWS cost model.
 *
 *   node scripts/cost-model.mjs
 *   node scripts/cost-model.mjs --buses 5 --cadence 5 --viewers 25
 *
 * The point of this file is that the arithmetic is reproducible and the
 * assumptions are editable. Every rate below is marked with where it came from
 * and whether it still needs checking for ap-south-1 on the day you deploy —
 * AWS regional rates change, and a number copied from a chat message is not a
 * budget.
 *
 * The budget is US$50 TOTAL for 30 days, not per month.
 */
import process from 'node:process';

// ---------------------------------------------------------------------------
// Rates. VERIFY the ones marked CHECK before provisioning.
// ---------------------------------------------------------------------------
const RATES = {
  // DynamoDB on-demand. AWS publishes $1.25/M WRU and $0.25/M RRU for
  // us-east-1. ap-south-1 is typically higher; 15% is a deliberately
  // conservative placeholder. CHECK against the Mumbai pricing table.
  dynamoWruPerMillion: 1.25 * 1.15,
  dynamoRruPerMillion: 0.25 * 1.15,
  dynamoStorageGbMonth: 0.285, // CHECK
  // A write request unit covers 1 KB (rounded up). A strongly consistent read
  // request unit covers 4 KB (rounded up). Source: DynamoDB on-demand pricing.
  wruKb: 1,
  rruKb: 4,

  // App Runner. The pricing page lists no ap-south-1 rate; these are the
  // Asia Pacific (Tokyo) rates used as a proxy. App Runner IS available in
  // Mumbai (added November 2023). CHECK the Mumbai rate.
  appRunnerVcpuHour: 0.081,
  appRunnerGbHour: 0.009,

  // Lightsail. Flat monthly price, same in every region; Mumbai gets half the
  // listed data-transfer allowance, which is still far more than this app uses.
  lightsailInstance5: 5.0, // 0.5 GB, 2 vCPU, 20 GB SSD
  lightsailContainerNano: 7.0, // 0.25 vCPU, 512 MB
  lightsailContainerMicro: 10.0, // 0.25 vCPU, 1 GB

  // Amazon Location Maps V2 bills dynamic maps by GetTiles requests; style,
  // glyph, and sprite requests are not billed. Routes V2 CalculateRoutes with
  // Car is in the Core bucket. Both rates are editable planning placeholders:
  // CHECK the current AWS pricing table and the response PricingBucket before
  // provisioning.
  locationTilesPer1000: 0.04,
  locationCoreRoutesPer1000: 0.50,

  // CloudWatch Logs ingestion. CHECK for Mumbai.
  logsPerGbIngested: 0.57,
  logsPerGbStored: 0.03,

  // Amplify Hosting.
  amplifyBuildMinute: 0.01,
  amplifyServedPerGb: 0.15,
  amplifyStoredPerGb: 0.023,

  // ECR storage beyond the free allowance.
  ecrPerGbMonth: 0.10,
};

const DAYS = 30;
const HOURS = DAYS * 24;

// ---------------------------------------------------------------------------
// Scenario inputs.
// ---------------------------------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

const input = {
  buses: arg('buses', 10),
  sourcesPerBus: arg('sources', 1),
  cadenceS: arg('cadence', 3),
  viewers: arg('viewers', 50),
  pollS: arg('poll', 1),
  /** Fraction of the 30 days the demo fleet is actually ON. 1 = continuous. */
  dutyCycle: arg('duty', 1),
  /** New interactive map sessions per day across all viewers. */
  mapSessionsPerDay: arg('sessions', 120),
  /** Approximate Maps V2 tile requests made by a fresh interactive session. */
  tilesPerMapSession: arg('tiles', 100),
  /** Admin route-generation requests over the full 30-day period. */
  routeCalculations: arg('routes', 20),
};

// ---------------------------------------------------------------------------
// Two data-model variants.
// ---------------------------------------------------------------------------
const VARIANTS = {
  current: {
    label: 'Current design (decision + event rings inside the STATE item)',
    stateItemKb: 20,
    rawLogKb: 0.3,
    writeRawLogs: true,
    /** No server-side cache: every viewer poll is its own strongly consistent read. */
    stateCacheS: 0,
    /** Every request produces a log line, including every viewer poll. */
    logsEveryRequest: true,
  },
  optimised: {
    label: 'Optimised (rings moved out, brief state cache, no raw logs for demo)',
    stateItemKb: 1.5,
    rawLogKb: 0.3,
    writeRawLogs: false,
    /** One authoritative read per journey per second, shared by all viewers. */
    stateCacheS: 1,
    logsEveryRequest: true,
  },
  lean: {
    label: 'Lean (optimised, plus: log mutations and errors only, not every poll)',
    stateItemKb: 1.5,
    rawLogKb: 0.3,
    writeRawLogs: false,
    stateCacheS: 1,
    // A successful state poll is not worth 300 bytes of billed log. Mutations,
    // rejections and errors are. This is the difference between ~39 GB and
    // ~2.6 GB of log ingestion over the month.
    logsEveryRequest: false,
  },
};

const ceil = (n) => Math.ceil(n - 1e-9);

function model(variant, compute) {
  const activeSeconds = DAYS * 86400 * input.dutyCycle;

  const reports =
    (input.buses * input.sourcesPerBus * activeSeconds) / input.cadenceS;

  // Each accepted report is one conditional write of the whole snapshot.
  const stateWru = reports * ceil(variant.stateItemKb / RATES.wruKb);
  const rawWru = variant.writeRawLogs
    ? reports * ceil(variant.rawLogKb / RATES.wruKb)
    : 0;
  const writeCost =
    ((stateWru + rawWru) / 1e6) * RATES.dynamoWruPerMillion;

  // Viewer polling. Without a cache every viewer poll reads the item; with one,
  // the API reads each live journey once per cache window and serves everyone
  // from that. Derived state is a pure function of the snapshot and the clock,
  // so a one-second cache cannot show anything the database did not say.
  const pollsPerSecond = input.viewers / input.pollS;
  const dbReadsPerSecond =
    variant.stateCacheS > 0 ? input.buses / variant.stateCacheS : pollsPerSecond;
  const reads = dbReadsPerSecond * DAYS * 86400;
  const readRru = reads * ceil(variant.stateItemKb / RATES.rruKb);
  const readCost = (readRru / 1e6) * RATES.dynamoRruPerMillion;

  const storageCost = 0.5 * RATES.dynamoStorageGbMonth;

  // Logs: one structured line per logged request, roughly 300 bytes.
  const polls = pollsPerSecond * DAYS * 86400;
  const loggedRequests = variant.logsEveryRequest ? reports + polls : reports;
  const logGb = (loggedRequests * 300) / 1e9;
  const logCost = logGb * RATES.logsPerGbIngested + logGb * RATES.logsPerGbStored;

  const mapTileRequests = input.mapSessionsPerDay * DAYS * input.tilesPerMapSession;
  const mapCost = (mapTileRequests / 1000) * RATES.locationTilesPer1000;
  const routeCost = (input.routeCalculations / 1000) * RATES.locationCoreRoutesPer1000;

  // Amplify: ~30 builds of ~3 minutes, a 1 MB bundle, modest transfer.
  const amplifyCost =
    30 * 3 * RATES.amplifyBuildMinute +
    2 * RATES.amplifyServedPerGb +
    0.05 * RATES.amplifyStoredPerGb;

  const ecrCost = 2 * RATES.ecrPerGbMonth;
  const cognitoCost = 0; // Well inside the free monthly active users for a demo.

  return {
    variant: variant.label,
    compute: compute.label,
    reports,
    dbWrites: stateWru + rawWru,
    dbReads: readRru,
    lines: [
      ['Compute (API + worker)', compute.cost],
      ['DynamoDB writes', writeCost],
      ['DynamoDB reads', readCost],
      ['DynamoDB storage', storageCost],
      ['CloudWatch Logs', logCost],
      ['Amazon map tile requests', mapCost],
      ['Amazon core route calls', routeCost],
      ['Amplify Hosting', amplifyCost],
      ['ECR storage', ecrCost],
      ['Cognito', cognitoCost],
    ],
  };
}

const COMPUTE = {
  appRunnerSmall: {
    label: 'App Runner 0.25 vCPU / 0.5 GB, active continuously',
    cost: HOURS * 0.25 * RATES.appRunnerVcpuHour + HOURS * 0.5 * RATES.appRunnerGbHour,
  },
  appRunner1: {
    label: 'App Runner 1 vCPU / 2 GB, active continuously',
    cost: HOURS * 1 * RATES.appRunnerVcpuHour + HOURS * 2 * RATES.appRunnerGbHour,
  },
  lightsail: {
    label: 'Lightsail $5 instance (API + worker on one box)',
    cost: RATES.lightsailInstance5,
  },
  lightsailContainer: {
    label: 'Lightsail container service, micro',
    cost: RATES.lightsailContainerMicro,
  },
};

function money(n) {
  return `$${n.toFixed(2)}`;
}

function report(result) {
  const total = result.lines.reduce((sum, [, cost]) => sum + cost, 0);
  console.log(`\n${result.variant}`);
  console.log(`  ${result.compute}`);
  console.log(
    `  ${(result.reports / 1e6).toFixed(2)}M reports, ` +
      `${(result.dbWrites / 1e6).toFixed(1)}M write units, ` +
      `${(result.dbReads / 1e6).toFixed(1)}M read units over ${DAYS} days`,
  );
  for (const [name, cost] of result.lines) {
    if (cost < 0.005) continue;
    console.log(`    ${name.padEnd(26)} ${money(cost).padStart(10)}`);
  }
  console.log(`    ${'TOTAL'.padEnd(26)} ${money(total).padStart(10)}`);
  console.log(
    `    ${total <= 35 ? 'inside the $35 operating target' : total <= 50 ? 'inside $50 but past the $35 target' : 'OVER the $50 ceiling'}`,
  );
  return total;
}

console.log('BusKothay — 30-day AWS cost model');
console.log(
  `Scenario: ${input.buses} buses x ${input.sourcesPerBus} source every ${input.cadenceS}s, ` +
    `${input.viewers} viewers polling every ${input.pollS}s, duty cycle ${(input.dutyCycle * 100).toFixed(0)}%`,
);
console.log('Budget: $50 total for 30 days. Operating target $35 + $15 contingency.');

report(model(VARIANTS.current, COMPUTE.appRunner1));
report(model(VARIANTS.current, COMPUTE.lightsail));
report(model(VARIANTS.optimised, COMPUTE.lightsail));
report(model(VARIANTS.lean, COMPUTE.lightsail));

// ---------------------------------------------------------------------------
// Sensitivity: Location usage depends on how many tiles each viewport fetches,
// so show the headroom rather than pretending the placeholder is exact.
// ---------------------------------------------------------------------------
const lean = model(VARIANTS.lean, COMPUTE.lightsail);
const withoutLocation = lean.lines
  .filter(([name]) => !name.startsWith('Amazon '))
  .reduce((sum, [, cost]) => sum + cost, 0);

const TARGET = 35;
const CEILING = 50;

console.log('\n--- Amazon Location sensitivity ---');
console.log(
  `Everything except Amazon Location, lean on Lightsail: ${money(withoutLocation)} for ${DAYS} days.`,
);
console.log(
  `Headroom for map tiles and route computations: ${money(TARGET - withoutLocation)} to the $${TARGET} target, ` +
    `${money(CEILING - withoutLocation)} to the $${CEILING} ceiling.`,
);
console.log(
  `At the placeholder $${RATES.locationTilesPer1000}/1,000 GetTiles requests that is ` +
    `${(((TARGET - withoutLocation) / RATES.locationTilesPer1000) * 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} tile requests ` +
    `to target, about ${Math.round(((TARGET - withoutLocation) / RATES.locationTilesPer1000) * 1000 / DAYS).toLocaleString('en-US')} per day.`,
);
console.log(`The scenario also includes ${input.routeCalculations} Core CalculateRoutes requests.`);

console.log(
  '\nRates marked CHECK in this file are unverified. Amazon Location pricing and free usage',
);
console.log(
  'can change and the value above is a placeholder.',
);
console.log('Confirm Maps V2 and Routes V2 pricing buckets first: they can decide the outcome.');
