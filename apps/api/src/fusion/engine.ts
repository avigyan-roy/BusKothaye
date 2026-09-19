import {
  ACCURACY_REJECT_M,
  AUTO_END_S,
  BACKWARD_TOLERANCE_M,
  BATCH_LIVE_MAX_AGE_MS,
  CORRIDOR_BASE_M,
  DEBUG_EVENT_RING,
  DWELL_DETECT_S,
  DWELL_SPEED_MPS,
  LIVE_MEASUREMENTS_PER_SECOND,
  MAX_JOURNEY_DURATION_MS,
  MAX_SPEED_MPS,
  NEW_SOURCE_PROBATION_MS,
  OFF_ROUTE_MIN_SOURCES,
  OFF_ROUTE_SUSTAIN_S,
  PUBLIC_EVENT_RING,
  RECONCILE_SIGMA,
  REPUTATION_MAX,
  REPUTATION_MIN,
  REPUTATION_PENALTY,
  REPUTATION_REWARD,
  SCHEMA_VERSION,
  SEARCH_BACKWARD_M,
  SEARCH_FORWARD_FLOOR_M,
  SOURCE_FRESHNESS_S,
  STOP_NEAR_M,
  STOP_PASS_MARGIN_M,
  computeAutoEndAtMs,
  computeEstimatedAtMs,
  computeStaleAtMs,
  distanceCapSM,
  capReachedAtMs,
  modeAtTime,
  positionAt,
  projectBounded,
  reportAgeMs,
  segmentTypicalSpeedMps,
  type ActiveSources,
  type DebugDecision,
  type DebugDto,
  type DebugEvent,
  type JourneyMode,
  type JourneyStateDto,
  type LocationReport,
  type PreparedRoute,
  type ProjectionAnchor,
  type PublicJourneyEvent,
  type RejectReason,
  type ReportDecision,
  type Role,
} from '@buskothay/shared';
import { projectToPolyline } from '@buskothay/geometry';
import { combine, type FusionSample } from './consensus.js';
import {
  initialFilter,
  predict,
  resetFilter,
  sigmaM as filterSigmaM,
  update,
  type FilterState,
} from './kalman.js';
import type {
  BaseMode,
  ContributorSnapshot,
  EndReason,
  JourneySnapshot,
} from './types.js';

/**
 * The journey engine.
 *
 * Every function here is pure: a snapshot and some inputs go in, a new snapshot
 * comes out. There is no clock inside — `nowMs` is always passed by the caller —
 * and no Express, AWS or persistence. That is what makes a conditional-write retry
 * safe (recompute the whole transition against the reloaded snapshot) and what
 * lets the outage and consensus behaviour be tested in milliseconds of simulated
 * time instead of real minutes.
 */

/** A report that is older than this is refused outright rather than kept as history. */
const TOO_OLD_MS = 60_000;

/** Bound on the client-reported sample age we are willing to believe. */
const MAX_TRUSTED_SAMPLE_AGE_MS = 120_000;

/** A second agreeing fix must land within this distance to confirm a re-entry. */
const REENTRY_CONFIRM_TOLERANCE_M = 120;

/** How long an unconfirmed re-entry claim stays open. */
const REENTRY_WINDOW_MS = 30_000;

// ---------------------------------------------------------------------------
// Creation and membership.
// ---------------------------------------------------------------------------

export interface CreateJourneyInput {
  readonly journeyId: string;
  readonly routeId: string;
  readonly routeVersion: string;
  readonly isDemo: boolean;
  readonly demoGeneration: number | null;
  readonly ownerAccountId: string;
  readonly nowMs: number;
  readonly driverContributorId: string;
  readonly driverTokenHash: string;
  readonly opsTokenHash: string;
  readonly joinCodeHash: string;
}

export function createJourneySnapshot(input: CreateJourneyInput): JourneySnapshot {
  const driver: ContributorSnapshot = newContributor({
    contributorId: input.driverContributorId,
    accountId: input.ownerAccountId,
    label: 'source-1',
    role: 'driver',
    tokenHash: input.driverTokenHash,
    joinedAtMs: input.nowMs,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    journeyId: input.journeyId,
    routeId: input.routeId,
    routeVersion: input.routeVersion,
    isDemo: input.isDemo,
    demoGeneration: input.demoGeneration,
    ownerAccountId: input.ownerAccountId,
    createdAtMs: input.nowMs,
    version: 1,
    baseMode: 'PENDING',
    endedAtMs: null,
    endReason: null,
    joinCodeHash: input.joinCodeHash,
    opsTokenHash: input.opsTokenHash,
    driverContributorId: input.driverContributorId,
    contributors: [driver],
    filter: null,
    lastConfirmedAtMs: null,
    lastConfirmedSM: null,
    journeyMeanMps: null,
    dwellSinceMs: null,
    passedStopIds: [],
    offRoute: false,
    offRouteSinceMs: null,
    ambiguity: null,
    events: [
      {
        id: `${input.journeyId}-e1`,
        atMs: input.nowMs,
        type: 'JOURNEY_STARTED',
        detail: {},
      },
    ],
    debugEvents: [],
    eventSeq: 1,
    failedJoinAttempts: 0,
    joinLockedUntilMs: null,
  };
}

function newContributor(input: {
  contributorId: string;
  accountId: string;
  label: string;
  role: Role;
  tokenHash: string;
  joinedAtMs: number;
}): ContributorSnapshot {
  return {
    contributorId: input.contributorId,
    accountId: input.accountId,
    label: input.label,
    role: input.role,
    tokenHash: input.tokenHash,
    joinedAtMs: input.joinedAtMs,
    revokedAtMs: null,
    lastSeq: null,
    lastReportAtMs: null,
    lastAcceptedAtMs: null,
    lastLiveFusionAtMs: null,
    lastSampleSM: null,
    lastSampleOffsetM: null,
    lastSampleAccuracyM: null,
    lastSampleAtMs: null,
    reputation: REPUTATION_MAX,
    acceptedCount: 0,
    rejectedCount: 0,
    lastDecision: null,
    lastWeightShare: null,
    offCorridorSinceMs: null,
    pendingReentry: null,
  };
}

export function addContributor(
  snapshot: JourneySnapshot,
  input: { contributorId: string; accountId: string; role: Role; tokenHash: string; nowMs: number },
): JourneySnapshot {
  const label = `source-${snapshot.contributors.length + 1}`;
  return {
    ...snapshot,
    version: snapshot.version + 1,
    failedJoinAttempts: 0,
    contributors: [
      ...snapshot.contributors,
      newContributor({
        contributorId: input.contributorId,
        accountId: input.accountId,
        label,
        role: input.role,
        tokenHash: input.tokenHash,
        joinedAtMs: input.nowMs,
      }),
    ],
  };
}

/** Rotate a lost/restored passenger capability without creating another source. */
export function rotateContributorCapability(
  snapshot: JourneySnapshot,
  contributorId: string,
  tokenHash: string,
): JourneySnapshot {
  return {
    ...snapshot,
    version: snapshot.version + 1,
    contributors: snapshot.contributors.map((contributor) =>
      contributor.contributorId === contributorId && contributor.revokedAtMs === null
        ? { ...contributor, tokenHash }
        : contributor,
    ),
  };
}

export function recordFailedJoin(snapshot: JourneySnapshot, nowMs: number, maxAttempts: number, lockoutMs: number): JourneySnapshot {
  const failed = snapshot.failedJoinAttempts + 1;
  return {
    ...snapshot,
    version: snapshot.version + 1,
    failedJoinAttempts: failed,
    joinLockedUntilMs: failed >= maxAttempts ? nowMs + lockoutMs : snapshot.joinLockedUntilMs,
  };
}

/** Revoking removes the capability's ability to report; it does not erase history. */
export function revokeContributor(
  snapshot: JourneySnapshot,
  contributorId: string,
  nowMs: number,
): JourneySnapshot {
  return {
    ...snapshot,
    version: snapshot.version + 1,
    contributors: snapshot.contributors.map((c) =>
      c.contributorId === contributorId && c.revokedAtMs === null
        ? { ...c, revokedAtMs: nowMs }
        : c,
    ),
  };
}

export function endJourney(
  snapshot: JourneySnapshot,
  nowMs: number,
  reason: EndReason,
): JourneySnapshot {
  if (snapshot.baseMode === 'ENDED') return snapshot;
  const [events, eventSeq] = pushPublicEvent(snapshot, {
    atMs: nowMs,
    type: 'JOURNEY_ENDED',
    detail: { reason },
  });
  return {
    ...snapshot,
    version: snapshot.version + 1,
    baseMode: 'ENDED',
    endedAtMs: nowMs,
    endReason: reason,
    dwellSinceMs: null,
    events,
    eventSeq,
  };
}

// ---------------------------------------------------------------------------
// Derived lifecycle: computed at read time, never by a background ticker.
// ---------------------------------------------------------------------------

/**
 * Whether the journey has already ended logically, and why.
 *
 * A journey whose evidence ran out 400 seconds ago is over whether or not any
 * cleanup job has run, so both reads and writes ask this question first. Repeated
 * reads give the same answer without changing anything.
 */
export function impliedEnd(
  snapshot: JourneySnapshot,
  nowMs: number,
): EndReason | null {
  if (snapshot.baseMode === 'ENDED') return snapshot.endReason;
  if (nowMs - snapshot.createdAtMs >= MAX_JOURNEY_DURATION_MS) return 'max_duration';
  const since = snapshot.lastConfirmedAtMs ?? snapshot.createdAtMs;
  if (nowMs - since >= AUTO_END_S * 1000) return 'inactivity';
  return null;
}

/** True once the journey should disappear from the active-journey list. */
export function isActive(snapshot: JourneySnapshot, nowMs: number): boolean {
  return impliedEnd(snapshot, nowMs) === null;
}

// ---------------------------------------------------------------------------
// Ingestion.
// ---------------------------------------------------------------------------

export interface IngestInput {
  readonly snapshot: JourneySnapshot;
  readonly route: PreparedRoute;
  readonly contributorId: string;
  readonly reports: readonly LocationReport[];
  /** When the request body was received by this process. */
  readonly receivedAtMs: number;
  /** Reference time for the whole transition. */
  readonly nowMs: number;
}

export interface IngestResult {
  readonly snapshot: JourneySnapshot;
  readonly decisions: readonly ReportDecision[];
  /** Diagnostic rows to append asynchronously. Never part of the acknowledgement. */
  readonly diagnostics: readonly DebugDecision[];
}

interface PreparedReport {
  readonly report: LocationReport;
  readonly index: number;
  readonly ageMs: number;
  reason: RejectReason | null;
  historyOnly: boolean;
  accepted: boolean;
  projectedSM: number | null;
  offsetM: number | null;
}

export function ingest(input: IngestInput): IngestResult {
  const { snapshot, route, contributorId, reports, receivedAtMs, nowMs } = input;
  const contributor = snapshot.contributors.find((c) => c.contributorId === contributorId);
  if (!contributor) {
    // The caller checks authorisation before reaching here; this is belt and braces.
    return {
      snapshot,
      decisions: reports.map((r) => ({
        seq: r.seq,
        accepted: false,
        reason: 'DUPLICATE' as RejectReason,
        historyOnly: false,
      })),
      diagnostics: [],
    };
  }

  // --- Stage 1: per-report validation, in input order. -----------------------
  const prepared: PreparedReport[] = [];
  let highestSeqSeen = contributor.lastSeq ?? -1;

  reports.forEach((report, index) => {
    const ageMs = reportAgeMs(
      receivedAtMs,
      nowMs,
      report.sampleAgeMs,
      MAX_TRUSTED_SAMPLE_AGE_MS,
    );
    const entry: PreparedReport = {
      report,
      index,
      ageMs,
      reason: null,
      historyOnly: false,
      accepted: false,
      projectedSM: null,
      offsetM: null,
    };

    if (contributor.lastSeq !== null && report.seq <= contributor.lastSeq) {
      entry.reason = 'DUPLICATE';
    } else if (report.seq < highestSeqSeen) {
      entry.reason = 'OUT_OF_ORDER';
    } else if (report.accuracyM > ACCURACY_REJECT_M) {
      entry.reason = 'POOR_ACCURACY';
    } else if (ageMs > TOO_OLD_MS) {
      entry.reason = 'TOO_OLD';
    }

    if (entry.reason === null) highestSeqSeen = Math.max(highestSeqSeen, report.seq);
    prepared.push(entry);
  });

  // --- Stage 2: choose at most one report to drive live state. ---------------
  // Replaying a backlog one fix at a time would walk the bus down the route in a
  // few milliseconds and shrink the filter's uncertainty as if the old samples
  // were new independent observations. Only the newest fresh report counts.
  const eligible = prepared.filter((p) => p.reason === null);
  let liveCandidate: PreparedReport | null = null;
  for (const entry of eligible) {
    if (liveCandidate === null || entry.report.seq > liveCandidate.report.seq) {
      liveCandidate = entry;
    }
  }

  const rateLimited =
    contributor.lastLiveFusionAtMs !== null &&
    nowMs - contributor.lastLiveFusionAtMs < 1000 / LIVE_MEASUREMENTS_PER_SECOND;

  if (liveCandidate !== null && (liveCandidate.ageMs > BATCH_LIVE_MAX_AGE_MS || rateLimited)) {
    liveCandidate = null;
  }
  for (const entry of eligible) {
    if (entry !== liveCandidate) entry.historyOnly = true;
  }

  // --- Stage 3: gates and fusion for the live candidate. ----------------------
  let next = snapshot;
  if (liveCandidate !== null) {
    next = applyLiveReport({
      snapshot,
      route,
      contributor,
      entry: liveCandidate,
      nowMs,
    });
  }

  // --- Stage 4: record sequence progress and per-source counters. -------------
  const acceptedCountDelta = prepared.filter((p) => p.accepted).length;
  const rejectedCountDelta = prepared.filter((p) => p.reason !== null).length;
  const lastDecision = [...prepared].reverse().find((p) => p.reason !== null)?.reason ?? null;

  next = {
    ...next,
    version: next.version === snapshot.version ? snapshot.version + 1 : next.version,
    contributors: next.contributors.map((c) =>
      c.contributorId !== contributorId
        ? c
        : {
            ...c,
            lastSeq: Math.max(c.lastSeq ?? -1, highestSeqSeen),
            lastReportAtMs: nowMs,
            acceptedCount: c.acceptedCount + acceptedCountDelta,
            rejectedCount: c.rejectedCount + rejectedCountDelta,
            lastDecision: lastDecision ?? (acceptedCountDelta > 0 ? null : c.lastDecision),
          },
    ),
  };

  const diagnostics: DebugDecision[] = prepared.map((p) => ({
    atMs: nowMs,
    sourceLabel: contributor.label,
    seq: p.report.seq,
    accepted: p.accepted,
    reason: p.reason,
    historyOnly: p.historyOnly,
    projectedSM: p.projectedSM,
    offsetM: p.offsetM,
  }));

  const decisions: ReportDecision[] = prepared.map((p) => ({
    seq: p.report.seq,
    accepted: p.accepted,
    reason: p.reason,
    historyOnly: p.historyOnly,
  }));

  return { snapshot: next, decisions, diagnostics };
}

interface ApplyLiveInput {
  readonly snapshot: JourneySnapshot;
  readonly route: PreparedRoute;
  readonly contributor: ContributorSnapshot;
  readonly entry: PreparedReport;
  readonly nowMs: number;
}

function applyLiveReport(input: ApplyLiveInput): JourneySnapshot {
  const { snapshot, route, contributor, entry, nowMs } = input;
  const report = entry.report;
  const routeLengthM = route.dto.lengthM;

  // --- Projection, with a window that grows with the gap. --------------------
  // A fixed 600 m forward window would exclude a legitimate return after a long
  // outage, so the search reach is elapsed time times a plausible maximum speed.
  const anchorSM = snapshot.filter?.sM ?? contributor.lastSampleSM ?? null;
  const gapMs = Math.max(
    0,
    nowMs - (snapshot.lastConfirmedAtMs ?? contributor.lastSampleAtMs ?? nowMs),
  );
  const projection =
    anchorSM === null
      ? projectToPolyline(route.line, report.lon, report.lat)
      : projectToPolyline(route.line, report.lon, report.lat, {
          minSM: anchorSM - SEARCH_BACKWARD_M,
          maxSM:
            anchorSM +
            Math.max(SEARCH_FORWARD_FLOOR_M, (gapMs / 1000) * MAX_SPEED_MPS),
        });

  const corridorLimitM = CORRIDOR_BASE_M + report.accuracyM;

  // --- Corridor gate, with an honest reason. ---------------------------------
  // A fix that lands outside the search window projects badly *within* it, which
  // would look like an off-corridor spoof. Re-projecting against the whole route
  // separates the two cases: a point that is on the road but implausibly far
  // away is impossible movement, not a spoof, and the ops page has to say which.
  if (projection === null || projection.offsetM > corridorLimitM) {
    const unwindowed = projectToPolyline(route.line, report.lon, report.lat);
    if (unwindowed !== null && unwindowed.offsetM <= corridorLimitM && anchorSM !== null) {
      entry.projectedSM = unwindowed.sM;
      entry.offsetM = unwindowed.offsetM;
      const deltaM = unwindowed.sM - anchorSM;
      const reason: RejectReason =
        deltaM < -BACKWARD_TOLERANCE_M - report.accuracyM ? 'BACKWARD' : 'IMPOSSIBLE_MOVEMENT';
      entry.reason = reason;
      return penalise(
        snapshot,
        contributor.contributorId,
        reason,
        nowMs,
        unwindowed.sM,
        unwindowed.offsetM,
      );
    }

    entry.projectedSM = projection?.sM ?? unwindowed?.sM ?? null;
    entry.offsetM = projection?.offsetM ?? unwindowed?.offsetM ?? null;
    entry.reason = 'OFF_CORRIDOR';
    return handleOffCorridor(
      snapshot,
      contributor,
      nowMs,
      entry.projectedSM,
      entry.offsetM,
    );
  }

  entry.projectedSM = projection.sM;
  entry.offsetM = projection.offsetM;

  // --- Movement gates, relative to this source's own previous fix. ------------
  if (contributor.lastSampleSM !== null && contributor.lastSampleAtMs !== null) {
    const dtS = Math.max(0.001, (nowMs - contributor.lastSampleAtMs) / 1000);
    const deltaM = projection.sM - contributor.lastSampleSM;
    if (Math.abs(deltaM) / dtS > MAX_SPEED_MPS) {
      entry.reason = 'IMPOSSIBLE_MOVEMENT';
      return penalise(
        snapshot,
        contributor.contributorId,
        'IMPOSSIBLE_MOVEMENT',
        nowMs,
        projection.sM,
        projection.offsetM,
      );
    }
    if (deltaM < -BACKWARD_TOLERANCE_M - report.accuracyM) {
      entry.reason = 'BACKWARD';
      return penalise(
        snapshot,
        contributor.contributorId,
        'BACKWARD',
        nowMs,
        projection.sM,
        projection.offsetM,
      );
    }
  }

  // --- Build the live sample set and find the consensus. ----------------------
  const freshnessCutoffMs = nowMs - SOURCE_FRESHNESS_S * 1000;
  const samples: FusionSample[] = [];
  const thisSample: FusionSample = {
    sourceId: contributor.contributorId,
    role: contributor.role,
    sM: projection.sM,
    accuracyM: report.accuracyM,
    offsetM: projection.offsetM,
    ageMs: 0,
    reputation: contributor.reputation,
    isProbationary: nowMs - contributor.joinedAtMs < NEW_SOURCE_PROBATION_MS,
  };
  samples.push(thisSample);

  for (const other of snapshot.contributors) {
    if (other.contributorId === contributor.contributorId) continue;
    if (other.revokedAtMs !== null) continue;
    if (
      other.lastSampleSM === null ||
      other.lastSampleAtMs === null ||
      other.lastSampleAtMs < freshnessCutoffMs
    ) {
      continue;
    }
    samples.push({
      sourceId: other.contributorId,
      role: other.role,
      sM: other.lastSampleSM,
      accuracyM: other.lastSampleAccuracyM ?? 30,
      offsetM: other.lastSampleOffsetM ?? 0,
      ageMs: nowMs - other.lastSampleAtMs,
      reputation: other.reputation,
      isProbationary: nowMs - other.joinedAtMs < NEW_SOURCE_PROBATION_MS,
    });
  }

  const predictedSM = predictedPositionSM(snapshot, route, nowMs);
  const consensus = combine(samples, predictedSM);

  if (consensus.outlierIds.includes(contributor.contributorId)) {
    // The majority cluster rejected this fix. The other sources still advance the
    // journey; this report does not, and its reputation falls modestly.
    entry.reason = 'CONSENSUS_OUTLIER';
    const penalised = penalise(
      snapshot,
      contributor.contributorId,
      'CONSENSUS_OUTLIER',
      nowMs,
      projection.sM,
      projection.offsetM,
    );
    return { ...penalised, ambiguity: consensus.ambiguity };
  }

  // --- Filter step, with the reconciliation branch. --------------------------
  const previousMode = derivedModeAt(snapshot, route, nowMs);
  let filter: FilterState;
  let corrected = false;
  let correctionM: number | null = null;
  let pendingReentry = contributor.pendingReentry;

  if (snapshot.filter === null || snapshot.lastConfirmedAtMs === null) {
    filter = initialFilter(consensus.sM, 0);
  } else {
    const dtS = Math.max(0, (nowMs - snapshot.lastConfirmedAtMs) / 1000);
    const predicted = predict(snapshot.filter, dtS, routeLengthM);
    const result = update(predicted, consensus.sM, consensus.sigmaM, routeLengthM);

    if (Math.abs(result.innovationM) > RECONCILE_SIGMA * result.innovationSigmaM) {
      const impliedSpeedMps = Math.abs(result.innovationM) / Math.max(0.5, dtS);
      const forward = result.innovationM > -BACKWARD_TOLERANCE_M;
      const plausible = impliedSpeedMps <= MAX_SPEED_MPS && forward;

      if (plausible) {
        // Large but feasible: reality wins over the filter's opinion.
        filter = resetFilter(
          consensus.sM,
          dtS > 0 ? Math.min(MAX_SPEED_MPS, Math.abs(result.innovationM) / dtS) : 0,
          Math.max(consensus.sigmaM * consensus.sigmaM, 400),
        );
        corrected = true;
        correctionM = result.innovationM;
        pendingReentry = null;
      } else {
        // Implausible. The moment after an outage is exactly when a spoofer has
        // the best chance of capturing a journey, so a jump this large needs a
        // second agreeing measurement before it is allowed to take over.
        const confirms =
          pendingReentry !== null &&
          nowMs - pendingReentry.atMs <= REENTRY_WINDOW_MS &&
          Math.abs(pendingReentry.sM - consensus.sM) <= REENTRY_CONFIRM_TOLERANCE_M;
        if (confirms) {
          filter = resetFilter(consensus.sM, 0, Math.max(consensus.sigmaM ** 2, 900));
          corrected = true;
          correctionM = result.innovationM;
          pendingReentry = null;
        } else {
          entry.reason = 'AMBIGUOUS_REENTRY';
          const held = penalise(
            snapshot,
            contributor.contributorId,
            'AMBIGUOUS_REENTRY',
            nowMs,
            projection.sM,
            projection.offsetM,
          );
          return {
            ...held,
            contributors: held.contributors.map((c) =>
              c.contributorId === contributor.contributorId
                ? { ...c, pendingReentry: { sM: consensus.sM, atMs: nowMs } }
                : c,
            ),
          };
        }
      }
    } else {
      filter = result.state;
      pendingReentry = null;
    }
  }

  entry.accepted = true;

  // --- Dwell detection. -------------------------------------------------------
  const movedM =
    snapshot.lastConfirmedSM === null ? null : Math.abs(filter.sM - snapshot.lastConfirmedSM);
  const looksStationary =
    filter.vMps < DWELL_SPEED_MPS && (movedM === null || movedM <= report.accuracyM);
  const dwellSinceMs = looksStationary ? (snapshot.dwellSinceMs ?? nowMs) : null;
  const isDwelling =
    dwellSinceMs !== null && nowMs - dwellSinceMs >= DWELL_DETECT_S * 1000;
  const baseMode: BaseMode = isDwelling ? 'DWELLING' : 'LIVE';

  // --- Stop passing, from accepted evidence only. -----------------------------
  const passedStopIds = new Set(snapshot.passedStopIds);
  for (const stop of route.dto.stops) {
    if (filter.sM >= stop.sM + STOP_PASS_MARGIN_M) passedStopIds.add(stop.id);
  }

  // --- Journey mean speed, a slow EWMA used as one ETA term. ------------------
  const journeyMeanMps =
    snapshot.journeyMeanMps === null
      ? filter.vMps
      : snapshot.journeyMeanMps * 0.9 + filter.vMps * 0.1;

  // --- Events. ----------------------------------------------------------------
  let events = snapshot.events;
  let eventSeq = snapshot.eventSeq;
  const newMode: JourneyMode = baseMode;
  if (previousMode !== newMode) {
    [events, eventSeq] = pushPublicEvent(
      { ...snapshot, events, eventSeq },
      {
        atMs: nowMs,
        type: 'TRACKING_MODE_CHANGED',
        detail: { fromMode: previousMode, toMode: newMode },
      },
    );
  }
  if (corrected) {
    [events, eventSeq] = pushPublicEvent(
      { ...snapshot, events, eventSeq },
      {
        atMs: nowMs,
        type: 'POSITION_CORRECTED',
        detail: { correctionM: correctionM ?? null },
      },
    );
  }

  const debugEvents: DebugEvent[] = [...snapshot.debugEvents];
  if (consensus.ambiguity !== null) {
    debugEvents.push({
      id: `${snapshot.journeyId}-d${eventSeq + 1}`,
      atMs: nowMs,
      kind: 'AMBIGUITY',
      detail: consensus.ambiguity,
    });
  }
  if (corrected) {
    debugEvents.push({
      id: `${snapshot.journeyId}-d${eventSeq + 2}`,
      atMs: nowMs,
      kind: 'RECONCILED',
      detail: `Corrected by ${(correctionM ?? 0).toFixed(0)} m after a ${(
        (nowMs - (snapshot.lastConfirmedAtMs ?? nowMs)) /
        1000
      ).toFixed(0)} s gap`,
    });
  }

  return {
    ...snapshot,
    version: snapshot.version + 1,
    baseMode,
    filter,
    lastConfirmedAtMs: nowMs,
    lastConfirmedSM: filter.sM,
    journeyMeanMps,
    dwellSinceMs,
    passedStopIds: [...passedStopIds],
    offRoute: false,
    offRouteSinceMs: null,
    ambiguity: consensus.ambiguity,
    events,
    eventSeq,
    debugEvents: debugEvents.slice(-DEBUG_EVENT_RING),
    contributors: snapshot.contributors.map((c) =>
      c.contributorId !== contributor.contributorId
        ? { ...c, lastWeightShare: consensus.weightShares.get(c.contributorId) ?? c.lastWeightShare }
        : {
            ...c,
            lastAcceptedAtMs: nowMs,
            lastLiveFusionAtMs: nowMs,
            lastSampleSM: projection.sM,
            lastSampleOffsetM: projection.offsetM,
            lastSampleAccuracyM: report.accuracyM,
            lastSampleAtMs: nowMs,
            lastWeightShare: consensus.weightShares.get(c.contributorId) ?? null,
            reputation: Math.min(REPUTATION_MAX, c.reputation + REPUTATION_REWARD),
            lastDecision: null,
            offCorridorSinceMs: null,
            pendingReentry,
          },
    ),
  };
}

/**
 * An off-corridor fix is normally a spoof or a bad fix and is simply rejected.
 * A genuine diversion looks different: several previously consistent sources all
 * leave the corridor and stay out. One newly joined phone cannot declare it.
 */
function handleOffCorridor(
  snapshot: JourneySnapshot,
  contributor: ContributorSnapshot,
  nowMs: number,
  projectedSM: number | null,
  offsetM: number | null,
): JourneySnapshot {
  const marked = snapshot.contributors.map((c) =>
    c.contributorId === contributor.contributorId
      ? { ...c, offCorridorSinceMs: c.offCorridorSinceMs ?? nowMs }
      : c,
  );

  const sustained = marked.filter(
    (c) =>
      c.revokedAtMs === null &&
      c.offCorridorSinceMs !== null &&
      nowMs - c.offCorridorSinceMs >= OFF_ROUTE_SUSTAIN_S * 1000 &&
      c.acceptedCount > 0,
  );

  const offRoute = sustained.length >= OFF_ROUTE_MIN_SOURCES;

  const penalised = penalise(
    { ...snapshot, contributors: marked },
    contributor.contributorId,
    'OFF_CORRIDOR',
    nowMs,
    projectedSM,
    offsetM,
  );

  if (!offRoute) return penalised;

  return {
    ...penalised,
    offRoute: true,
    offRouteSinceMs: penalised.offRouteSinceMs ?? nowMs,
    ambiguity:
      'Several sources agree the vehicle has left the route. The position is held at the last confirmed point on the route and arrival estimates are suppressed.',
  };
}

function penalise(
  snapshot: JourneySnapshot,
  contributorId: string,
  reason: RejectReason,
  nowMs: number,
  projectedSM: number | null,
  offsetM: number | null,
): JourneySnapshot {
  return {
    ...snapshot,
    version: snapshot.version + 1,
    contributors: snapshot.contributors.map((c) =>
      c.contributorId !== contributorId
        ? c
        : {
            ...c,
            // Modest and recoverable: a handful of noisy fixes must not expel an
            // honest contributor who walked past a tall building.
            reputation: Math.max(REPUTATION_MIN, c.reputation - REPUTATION_PENALTY),
            lastDecision: reason,
            lastReportAtMs: nowMs,
            lastSampleOffsetM: offsetM ?? c.lastSampleOffsetM,
            // A rejected fix never becomes the source's fusion sample.
            lastSampleSM: c.lastSampleSM,
          },
    ),
  };
}

function pushPublicEvent(
  snapshot: JourneySnapshot,
  event: Omit<PublicJourneyEvent, 'id'>,
): [PublicJourneyEvent[], number] {
  const eventSeq = snapshot.eventSeq + 1;
  const withId: PublicJourneyEvent = { ...event, id: `${snapshot.journeyId}-e${eventSeq}` };
  return [[...snapshot.events, withId].slice(-PUBLIC_EVENT_RING), eventSeq];
}

// ---------------------------------------------------------------------------
// Derived views.
// ---------------------------------------------------------------------------

/** Speed used for dead reckoning, blended toward the authored segment speed. */
function projectionSpeedMps(snapshot: JourneySnapshot, route: PreparedRoute): number {
  if (snapshot.filter === null) return 0;
  if (snapshot.baseMode === 'DWELLING') return 0;
  // A bus already at rest must not be started moving by a segment prior.
  if (snapshot.filter.vMps < DWELL_SPEED_MPS) return snapshot.filter.vMps;
  const typical = segmentTypicalSpeedMps(route.dto, snapshot.filter.sM);
  // A vehicle whose GPS vanished is more likely stuck than cruising, so the
  // projection leans part of the way toward the typical speed for this stretch.
  return 0.7 * snapshot.filter.vMps + 0.3 * typical;
}

/** The next stop the bus has not been confirmed past, used as the projection cap. */
function nextUnpassedStopSM(
  snapshot: JourneySnapshot,
  route: PreparedRoute,
  fromSM: number,
): number {
  const passed = new Set(snapshot.passedStopIds);
  for (const stop of route.dto.stops) {
    if (!passed.has(stop.id) && stop.sM > fromSM) return stop.sM;
  }
  return route.dto.lengthM;
}

export function buildAnchor(
  snapshot: JourneySnapshot,
  route: PreparedRoute,
): ProjectionAnchor | null {
  if (snapshot.filter === null || snapshot.lastConfirmedAtMs === null) return null;

  const confirmedAtMs = snapshot.lastConfirmedAtMs;
  const sM = snapshot.filter.sM;
  const speedMps = projectionSpeedMps(snapshot, route);
  const capSM = Math.max(
    sM,
    Math.min(distanceCapSM(sM, route.dto.lengthM), nextUnpassedStopSM(snapshot, route, sM)),
  );

  const estimatedAtMs = computeEstimatedAtMs(confirmedAtMs);
  const base: ProjectionAnchor = {
    confirmedAtMs,
    sM,
    speedMps,
    capSM,
    estimatedAtMs,
    staleAtMs: estimatedAtMs,
    endedAtMs: computeAutoEndAtMs(confirmedAtMs),
    sigmaM: filterSigmaM(snapshot.filter),
    covariance: snapshot.filter.covariance as ProjectionAnchor['covariance'],
  };

  return { ...base, staleAtMs: computeStaleAtMs(confirmedAtMs, estimatedAtMs, capReachedAtMs(base)) };
}

/** Where the filter thinks the bus is right now, used for continuity checks. */
function predictedPositionSM(
  snapshot: JourneySnapshot,
  route: PreparedRoute,
  nowMs: number,
): number | null {
  const anchor = buildAnchor(snapshot, route);
  if (anchor === null) return null;
  return projectBounded(anchor, nowMs).sM;
}

export function derivedModeAt(
  snapshot: JourneySnapshot,
  route: PreparedRoute,
  nowMs: number,
): JourneyMode {
  if (snapshot.baseMode === 'ENDED') return 'ENDED';
  if (impliedEnd(snapshot, nowMs) !== null) return 'ENDED';
  if (snapshot.baseMode === 'PENDING') return 'PENDING';
  return modeAtTime(snapshot.baseMode, buildAnchor(snapshot, route), nowMs);
}

/**
 * A boarding gate based only on fresh confirmed evidence. Projection may move a
 * marker towards a stop, but it can never make a bus boardable.
 */
export function boardableStopIdAt(
  snapshot: JourneySnapshot,
  route: PreparedRoute,
  nowMs: number,
): string | null {
  const mode = derivedModeAt(snapshot, route, nowMs);
  if (mode !== 'LIVE' && mode !== 'DWELLING') return null;
  if (snapshot.offRoute || snapshot.lastConfirmedSM === null) return null;
  const passed = new Set(snapshot.passedStopIds);
  let nearest: { id: string; distanceM: number } | null = null;
  for (const stop of route.dto.stops) {
    if (passed.has(stop.id)) continue;
    const distanceM = Math.abs(stop.sM - snapshot.lastConfirmedSM);
    if (distanceM > STOP_NEAR_M) continue;
    if (nearest === null || distanceM < nearest.distanceM) nearest = { id: stop.id, distanceM };
  }
  return nearest?.id ?? null;
}

function countActiveSources(snapshot: JourneySnapshot, nowMs: number): ActiveSources {
  const cutoff = nowMs - SOURCE_FRESHNESS_S * 1000;
  let driver = false;
  let conductor = 0;
  let passengers = 0;
  for (const c of snapshot.contributors) {
    if (c.revokedAtMs !== null) continue;
    if (c.lastAcceptedAtMs === null || c.lastAcceptedAtMs < cutoff) continue;
    if (c.role === 'driver') driver = true;
    else if (c.role === 'conductor') conductor += 1;
    else passengers += 1;
  }
  return { driver, conductor, passengers };
}

export interface DeriveStateInput {
  readonly snapshot: JourneySnapshot;
  readonly route: PreparedRoute;
  readonly nowMs: number;
  readonly computeStopEtas: (input: {
    mode: JourneyMode;
    sM: number | null;
    vMps: number | null;
    journeyMeanMps: number | null;
    offRoute: boolean;
    passedStopIds: ReadonlySet<string>;
    speedEstablished: boolean;
  }) => JourneyStateDto['stops'];
  readonly delaySeconds: number | null;
}

export function deriveState(input: DeriveStateInput): JourneyStateDto {
  const { snapshot, route, nowMs } = input;
  const anchor = buildAnchor(snapshot, route);
  const mode = derivedModeAt(snapshot, route, nowMs);

  const projected = anchor === null ? null : projectBounded(anchor, nowMs);
  const positionSM = projected === null ? null : projected.sM;

  const position =
    positionSM === null
      ? null
      : { ...positionAt(route, positionSM), sM: positionSM };

  const lastConfirmedPosition =
    snapshot.lastConfirmedSM === null
      ? null
      : { ...positionAt(route, snapshot.lastConfirmedSM), sM: snapshot.lastConfirmedSM };

  // Confidence grows on its own while no measurement arrives, then freezes with
  // the estimate. It is an indicative spread, not a calibrated probability.
  let confidenceM: number | null = null;
  if (snapshot.filter !== null && anchor !== null) {
    const freezeAtMs = Math.max(anchor.staleAtMs, anchor.confirmedAtMs);
    const dtS = Math.max(0, (Math.min(nowMs, freezeAtMs) - anchor.confirmedAtMs) / 1000);
    confidenceM = filterSigmaM(predict(snapshot.filter, dtS, route.dto.lengthM));
  }

  const trackingModes: JourneyMode[] = ['LIVE', 'DWELLING', 'ESTIMATED'];
  const speedKmh =
    snapshot.filter !== null && trackingModes.includes(mode)
      ? (snapshot.baseMode === 'DWELLING' ? 0 : snapshot.filter.vMps) * 3.6
      : null;

  const stops = input.computeStopEtas({
    mode,
    sM: positionSM,
    vMps: snapshot.filter?.vMps ?? null,
    journeyMeanMps: snapshot.journeyMeanMps,
    offRoute: snapshot.offRoute,
    passedStopIds: new Set(snapshot.passedStopIds),
    speedEstablished:
      snapshot.contributors.reduce((total, c) => total + c.acceptedCount, 0) >= 2,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    journeyId: snapshot.journeyId,
    routeId: snapshot.routeId,
    routeVersion: snapshot.routeVersion,
    stateVersion: snapshot.version,
    isDemo: snapshot.isDemo,
    mode,
    position,
    lastConfirmedPosition,
    lastConfirmedAtMs: snapshot.lastConfirmedAtMs,
    projection: mode === 'ENDED' ? null : anchor,
    confidenceM,
    speedKmh,
    lastFixAgeSeconds:
      snapshot.lastConfirmedAtMs === null
        ? null
        : Math.max(0, (nowMs - snapshot.lastConfirmedAtMs) / 1000),
    progressFraction:
      positionSM === null
        ? null
        : Math.min(1, Math.max(0, positionSM / route.dto.lengthM)),
    activeSources: countActiveSources(snapshot, nowMs),
    boardableStopId: boardableStopIdAt(snapshot, route, nowMs),
    stops,
    delaySeconds: input.delaySeconds,
    offRoute: snapshot.offRoute,
    events: [...snapshot.events],
    serverTs: nowMs,
  };
}

export function deriveDebug(
  snapshot: JourneySnapshot,
  route: PreparedRoute,
  nowMs: number,
  storage: DebugDto['storage'],
  decisions: readonly DebugDecision[],
): DebugDto {
  const anchor = buildAnchor(snapshot, route);
  const cutoff = nowMs - SOURCE_FRESHNESS_S * 1000;

  return {
    schemaVersion: SCHEMA_VERSION,
    journeyId: snapshot.journeyId,
    routeId: snapshot.routeId,
    routeVersion: snapshot.routeVersion,
    stateVersion: snapshot.version,
    isDemo: snapshot.isDemo,
    mode: derivedModeAt(snapshot, route, nowMs),
    anchor:
      anchor === null
        ? null
        : {
            sM: anchor.sM,
            speedMps: anchor.speedMps,
            sigmaM: anchor.sigmaM,
            covariance: anchor.covariance,
            confirmedAtMs: anchor.confirmedAtMs,
          },
    offRoute: snapshot.offRoute,
    ambiguity: snapshot.ambiguity,
    sources: snapshot.contributors.slice(0, 24).map((c) => ({
      label: c.label,
      role: c.role,
      joinedAtMs: c.joinedAtMs,
      lastReportAtMs: c.lastReportAtMs,
      lastAcceptedAtMs: c.lastAcceptedAtMs,
      ageSeconds:
        c.lastAcceptedAtMs === null
          ? null
          : Math.max(0, (nowMs - c.lastAcceptedAtMs) / 1000),
      lastAccuracyM: c.lastSampleAccuracyM,
      lastProjectedSM: c.lastSampleSM,
      lastOffsetM: c.lastSampleOffsetM,
      weightShare: c.lastWeightShare,
      reputation: c.reputation,
      acceptedCount: c.acceptedCount,
      rejectedCount: c.rejectedCount,
      lastDecision: c.lastDecision,
      isLive: c.revokedAtMs === null && c.lastAcceptedAtMs !== null && c.lastAcceptedAtMs >= cutoff,
    })),
    decisions: [...decisions],
    events: [...snapshot.debugEvents],
    storage,
    serverTs: nowMs,
  };
}
