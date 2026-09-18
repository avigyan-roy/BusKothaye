/**
 * Every tunable number in BusKothay, in one file, with its unit in its name.
 *
 * Changing a value here changes the server, the browser and the simulator
 * together — that is the entire point of the file. Tune only with recorded test
 * evidence, and update the affected scenario expectations in the same change.
 * See docs/MANUAL_EDITING.md.
 */

/** Wire format version carried by every DTO that has one. */
export const SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Measurement gates — applied to one incoming report, before any fusion.
// ---------------------------------------------------------------------------

/**
 * Reported accuracy below this is treated as this value. Some browsers report
 * implausibly small radii; believing them would let one phone dominate the
 * inverse-variance weighting.
 */
export const ACCURACY_FLOOR_M = 5;

/**
 * Above this, the fix is rejected outright. Phone GPS on a bus is typically
 * 5–30 m; 100 m and worse is usually a wifi or cell-tower fix.
 */
export const ACCURACY_REJECT_M = 100;

/**
 * Perpendicular distance from the route beyond which a fix is off-corridor.
 * The reported accuracy is added to this, so a noisy-but-honest fix is not
 * punished for its own uncertainty.
 */
export const CORRIDOR_BASE_M = 60;

/** A city bus faster than this implies a jump or a lie. 90 km/h. */
export const MAX_SPEED_MPS = 25;

/** Along-route noise tolerated before movement counts as genuinely backward. */
export const BACKWARD_TOLERANCE_M = 30;

// ---------------------------------------------------------------------------
// Freshness and the journey state machine.
// ---------------------------------------------------------------------------

/** Exponential freshness decay constant. A 10 s old fix is worth 1/e. */
export const FRESHNESS_TAU_S = 10;

/** A source stops counting as live this long after its last accepted fix. */
export const SOURCE_FRESHNESS_S = 10;

/** LIVE or DWELLING degrades to ESTIMATED after this long with no accepted fix. */
export const LIVE_TIMEOUT_S = 10;

/**
 * Hard limit on dead reckoning. Beyond roughly 90 s, speed uncertainty of about
 * ±40% makes the projected position less informative than saying nothing, so the
 * estimate freezes and the UI says when the position was last confirmed.
 */
export const ESTIMATE_HORIZON_S = 90;

/** Absolute distance an estimate may travel past its anchor before freezing. */
export const MAX_PROJECTED_M = 600;

/** Without accepted evidence, a journey ends automatically after this long. */
export const AUTO_END_S = 300;

/** No journey may run longer than this, accepted fixes or not. */
export const MAX_JOURNEY_DURATION_MS = 6 * 60 * 60 * 1000;

/** Evidence consistent with being stationary for this long produces DWELLING. */
export const DWELL_DETECT_S = 30;

/** Movement below this speed counts as stationary for dwell detection. */
export const DWELL_SPEED_MPS = 0.6;

/**
 * Accepted evidence must be at least this far beyond a stop before the stop is
 * marked passed. A predicted position never marks a stop passed at all.
 */
export const STOP_PASS_MARGIN_M = 15;

/** Within this distance a stop is reported as `near` rather than `upcoming`. */
export const STOP_NEAR_M = 120;

// ---------------------------------------------------------------------------
// Fusion.
// ---------------------------------------------------------------------------

/** Process noise for the constant-velocity filter, m²/s³ (bus acceleration). */
export const KALMAN_PROCESS_NOISE = 1.0;

/** Initial along-route variance when a journey's first fix arrives, m². */
export const KALMAN_INITIAL_POSITION_VAR = 900;

/** Initial speed variance, (m/s)². Wide: we know nothing about speed yet. */
export const KALMAN_INITIAL_SPEED_VAR = 25;

/** Innovations beyond this many sigma are treated as a possible reset, not noise. */
export const RECONCILE_SIGMA = 3;

/** Floor on published confidence for a single-source journey, metres. */
export const SINGLE_SOURCE_SIGMA_FLOOR_M = 15;

/** Two sources further apart than this along the route genuinely disagree. */
export const TWO_SOURCE_DISAGREEMENT_M = 150;

/** Retained samples split by more than this probably describe two buses. */
export const BIMODAL_SEPARATION_M = 200;

/** With three or more surviving sources, no single source exceeds this weight share. */
export const MAX_SINGLE_SOURCE_WEIGHT_SHARE = 0.45;

/** MAD multiplier for the majority-cluster filter, and its metre floor. */
export const MAD_MULTIPLIER = 3;
export const MAD_FLOOR_M = 50;

/** Trust ceilings by role. A self-declared conductor is not proof of authority. */
export const ROLE_TRUST = {
  driver: 1.0,
  conductor: 0.9,
  passenger: 0.6,
} as const;

/** A contributor's first fixes carry less weight until they have a track record. */
export const NEW_SOURCE_PROBATION_MS = 60_000;
export const NEW_SOURCE_TRUST_MULTIPLIER = 0.66;

/** Reputation moves slowly and recovers; three noisy fixes must not expel anyone. */
export const REPUTATION_START = 1.0;
export const REPUTATION_MAX = 1.0;
export const REPUTATION_MIN = 0.1;
export const REPUTATION_REWARD = 0.05;
export const REPUTATION_PENALTY = 0.2;

/** Sustained agreement required from previously consistent sources to call a diversion. */
export const OFF_ROUTE_MIN_SOURCES = 2;
export const OFF_ROUTE_SUSTAIN_S = 20;

/** Recovery: the search window grows with elapsed time at this plausible speed. */
export const RECOVERY_SEARCH_SPEED_MPS = MAX_SPEED_MPS;
/** Minimum forward reach of the projection search even for a tiny elapsed time. */
export const SEARCH_FORWARD_FLOOR_M = 400;
/** Backward reach of the projection search; a bus does not reverse far. */
export const SEARCH_BACKWARD_M = 200;

// ---------------------------------------------------------------------------
// ETA.
// ---------------------------------------------------------------------------

/** Effective speed is clamped into this band: 5 km/h to 60 km/h. */
export const ETA_MIN_SPEED_MPS = 1.4;
export const ETA_MAX_SPEED_MPS = 16.7;

/** Blend weights for current, journey-average and authored segment speed. */
export const ETA_WEIGHT_NOW = 0.5;
export const ETA_WEIGHT_JOURNEY = 0.2;
export const ETA_WEIGHT_SEGMENT = 0.3;

/** Allowance added per intermediate stop, seconds. */
export const ETA_DWELL_PER_STOP_S = 20;

/** Half-width of the published arrival range, by confidence in the position. */
export const ETA_RANGE_FRACTION_LIVE = 0.25;
export const ETA_RANGE_FRACTION_ESTIMATED = 0.4;

// ---------------------------------------------------------------------------
// Transport limits.
// ---------------------------------------------------------------------------

/** Contributor upload cadence target, milliseconds between flushes. */
export const CONTRIBUTOR_FLUSH_MS = 3000;

/** Client-side queue cap before the oldest unsent reports are dropped. */
export const CONTRIBUTOR_QUEUE_MAX = 200;

/** Server limits on one ingestion request. */
export const MAX_BATCH_REPORTS = 60;
export const MAX_BODY_BYTES = 64 * 1024;

/** Even the newest report in a batch is history-only once it is this old. */
export const BATCH_LIVE_MAX_AGE_MS = 10_000;

/** Per-capability ingestion rate limit. */
export const RATE_LIMIT_REPORTS_PER_SECOND = 5;
/** At most this many measurements per source per second reach live fusion. */
export const LIVE_MEASUREMENTS_PER_SECOND = 1;

/** Create and join limits, per IP, with burst room for a team on one wifi. */
export const RATE_LIMIT_CREATE_PER_MINUTE = 6;
export const RATE_LIMIT_CREATE_BURST = 3;
export const RATE_LIMIT_JOIN_PER_MINUTE = 20;
export const RATE_LIMIT_JOIN_BURST = 5;

/** Simultaneous contributors on one journey. */
export const MAX_CONTRIBUTORS = 24;

/** Failed join-code attempts tolerated per journey before joins are locked out. */
export const MAX_JOIN_ATTEMPTS = 20;
export const JOIN_LOCKOUT_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Retention. See docs/DECISIONS.md §6 — these are honest limits, not erasure.
// ---------------------------------------------------------------------------

/** Raw reports leave application access after this long; TTL deletes later. */
export const RAW_REPORT_RETENTION_MS = 48 * 60 * 60 * 1000;

/** An ended journey stays readable as a tombstone for this long. */
export const JOURNEY_TOMBSTONE_MS = 24 * 60 * 60 * 1000;

/** Idempotency keys are honoured for this long. */
export const IDEMPOTENCY_RETENTION_MS = 15 * 60 * 1000;

/** Bounded rings kept inside the authoritative state item. */
export const PUBLIC_EVENT_RING = 20;
export const DEBUG_EVENT_RING = 50;
export const DEBUG_DECISION_RING = 100;
export const DEBUG_SOURCE_LIMIT = 24;

/** Conditional-write conflicts retried before returning a retryable 503. */
export const WRITE_CONFLICT_MAX_RETRIES = 4;

/** Passenger poll cadence targets. */
export const PASSENGER_POLL_MS = 1000;
export const OPS_POLL_MS = 1500;
