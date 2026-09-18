import {
  CONTRIBUTOR_FLUSH_MS,
  MAX_BATCH_REPORTS,
  prepareFromDto,
  type DebugDto,
  type JourneyMode,
  type LocationReport,
  type PreparedRoute,
} from '@buskothay/shared';
import { ApiClient, SimulatorApiError } from './client.js';
import { createRng } from './rng.js';
import { isInWindow, truthSM, type Scenario } from './scenario.js';
import { SimulatedSource } from './source.js';

/**
 * Runs one scenario against a live API at real speed.
 *
 * `timeScale` is fixed at 1 on purpose. A simulator cannot secretly accelerate a
 * server's clock, so a deployed run that claims to have compressed three minutes
 * into twenty seconds has measured something other than the system. Fast
 * time-travel belongs to the pure-engine tests, which inject a clock and say so.
 */

export interface Sample {
  readonly tS: number;
  readonly mode: JourneyMode;
  readonly truthSM: number;
  readonly estimateSM: number | null;
  readonly errorM: number | null;
  readonly confidenceM: number | null;
  readonly passedStopCount: number;
}

export interface RunResult {
  readonly scenario: Scenario;
  readonly journeyId: string;
  readonly startedAtMs: number;
  readonly samples: readonly Sample[];
  readonly debug: DebugDto | null;
  readonly secondJourneyId: string | null;
  readonly secondJourneySamples: readonly Sample[];
  readonly transportErrors: readonly string[];
}

const TICK_MS = 250;

export async function runScenario(
  scenario: Scenario,
  api: ApiClient,
  log: (line: string) => void,
): Promise<RunResult> {
  const routeDto = await api.getRoute(scenario.routeId);
  const route: PreparedRoute = prepareFromDto(routeDto);
  const rng = createRng(scenario.seed);
  const startWallMs = Date.now();

  const created = await api.createJourney(scenario.routeId);
  log(
    `journey ${created.journeyId} created (demo), route ${routeDto.code} ${routeDto.origin} → ${routeDto.destination}`,
  );

  const sources = scenario.sources.map(
    (spec) => new SimulatedSource(spec, scenario, route, rng, startWallMs),
  );

  // The first source is the driver: it is the one that created the journey.
  const driver = sources[0]!;
  driver.token = created.contributorToken;
  for (const source of sources.slice(1)) {
    const role = source.spec.role === 'driver' ? 'conductor' : source.spec.role;
    const joined = await api.join(created.journeyId, created.joinCode, role);
    source.token = joined.contributorToken;
  }
  log(`${sources.length} source(s) joined`);

  // An optional second journey on the same route, to prove the backend keeps
  // independent state rather than one global bus.
  let second: { journeyId: string; token: string } | null = null;
  if (scenario.secondJourney) {
    const other = await api.createJourney(scenario.routeId);
    second = { journeyId: other.journeyId, token: other.contributorToken };
    log(`second journey ${other.journeyId} created for isolation checking`);
  }

  const samples: Sample[] = [];
  const secondSamples: Sample[] = [];
  const transportErrors: string[] = [];
  const lastSendAt = new Map<string, number>();
  let lastPollAt = -1;

  const endAtMs = startWallMs + scenario.durationS * 1000;
  let inFlight = false;
  const pendingRequests = new Set<Promise<void>>();

  while (Date.now() < endAtMs) {
    const tS = (Date.now() - startWallMs) / 1000;

    for (const source of sources) {
      const last = lastSendAt.get(source.spec.name) ?? -Infinity;
      if (tS - last < source.spec.cadenceS) continue;
      lastSendAt.set(source.spec.name, tS);

      if (!source.isProducing(tS)) continue;
      const report = source.sample(tS);

      if (source.isPartitioned(tS)) {
        // Offline: hold it. Nothing was lost, it just has not been sent.
        source.buffer(report, tS);
        continue;
      }

      const backlog = source.drainBuffer(tS);
      // Newest first so the current position drives live state; the older reports
      // travel in the same batch and must land as history.
      const batch: LocationReport[] = [...backlog, report]
        .slice(-MAX_BATCH_REPORTS)
        .sort((a, b) => a.seq - b.seq);

      track(send(source, batch));
    }

    if (tS - lastPollAt >= 1) {
      lastPollAt = tS;
      track(poll(tS));
    }

    await sleep(TICK_MS);
  }

  // Every scheduled request is tracked. Do not read final diagnostics while a
  // late upload can still mutate them.
  while (inFlight || pendingRequests.size > 0) {
    await Promise.allSettled([...pendingRequests]);
  }

  let debug: DebugDto | null = null;
  try {
    debug = await api.debug(created.journeyId, created.opsToken);
  } catch (error) {
    transportErrors.push(`debug read failed: ${describe(error)}`);
  }

  // The simulator ends its own journey and nobody else's.
  try {
    await api.end(created.journeyId);
    if (second) await api.end(second.journeyId);
  } catch (error) {
    transportErrors.push(`end failed: ${describe(error)}`);
  }

  return {
    scenario,
    journeyId: created.journeyId,
    startedAtMs: startWallMs,
    samples,
    debug,
    secondJourneyId: second?.journeyId ?? null,
    secondJourneySamples: secondSamples,
    transportErrors,
  };

  async function send(source: SimulatedSource, batch: LocationReport[]): Promise<void> {
    if (source.token === null) return;
    try {
      const response = await api.report(created.journeyId, source.token, batch);
      source.sent += batch.length;
      source.rejected += response.results.filter(
        (r) => !r.accepted && r.reason !== null,
      ).length;
    } catch (error) {
      if (error instanceof SimulatorApiError && error.status === 429) {
        // The simulator obeys the same rate limits as any contributor.
        return;
      }
      transportErrors.push(`report failed: ${describe(error)}`);
    }
  }

  async function poll(tS: number): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      const state = await api.state(created.journeyId);
      const truth = truthSM(scenario, tS);
      const estimate = state.position?.sM ?? null;
      samples.push({
        tS,
        mode: state.mode,
        truthSM: truth,
        estimateSM: estimate,
        errorM: estimate === null ? null : estimate - truth,
        confidenceM: state.confidenceM,
        passedStopCount: state.stops.filter((s) => s.status === 'passed').length,
      });

      if (second) {
        const otherState = await api.state(second.journeyId);
        secondSamples.push({
          tS,
          mode: otherState.mode,
          truthSM: truth,
          estimateSM: otherState.position?.sM ?? null,
          errorM: null,
          confidenceM: otherState.confidenceM,
          passedStopCount: 0,
        });
      }
    } catch (error) {
      transportErrors.push(`state poll failed: ${describe(error)}`);
    } finally {
      inFlight = false;
    }
  }

  function track(promise: Promise<void>): void {
    pendingRequests.add(promise);
    void promise.finally(() => pendingRequests.delete(promise));
  }
}

/** True when every source is deliberately silent at this moment. */
export function isBlackout(scenario: Scenario, tS: number): boolean {
  if (isInWindow(scenario.blackouts, tS)) return true;
  return scenario.sources.every(
    (spec) =>
      tS < spec.activeFromS ||
      tS >= spec.activeUntilS ||
      isInWindow(spec.outages, tS) ||
      isInWindow(spec.partitions, tS),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { CONTRIBUTOR_FLUSH_MS };
