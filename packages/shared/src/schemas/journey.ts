import { z } from 'zod';
import { MAX_BATCH_REPORTS, PUBLIC_EVENT_RING } from '../constants.js';
import {
  EpochMsSchema,
  IdSchema,
  JoinRoleSchema,
  LatitudeSchema,
  LongitudeSchema,
  RoleSchema,
  SchemaVersionSchema,
} from './common.js';

// ---------------------------------------------------------------------------
// Creating and joining a journey.
// ---------------------------------------------------------------------------

export const CreateJourneyBodySchema = z.object({
  routeId: IdSchema,
});
export type CreateJourneyBody = z.infer<typeof CreateJourneyBodySchema>;

export const CreateJourneyResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  journeyId: IdSchema,
  routeId: IdSchema,
  routeVersion: z.string(),
  contributorId: IdSchema,
  /** Driver capability. Returned exactly once; the server keeps only its hash. */
  contributorToken: z.string(),
  /** Read-only diagnostics capability, separate from the driver capability. */
  opsToken: z.string(),
  joinCode: z.string(),
  role: z.literal('driver'),
  isDemo: z.boolean(),
  createdAtMs: EpochMsSchema,
});
export type CreateJourneyResponse = z.infer<typeof CreateJourneyResponseSchema>;

export const JoinJourneyBodySchema = z.object({
  joinCode: z.string().min(4).max(32),
  role: JoinRoleSchema,
});
export type JoinJourneyBody = z.infer<typeof JoinJourneyBodySchema>;

export const JoinJourneyResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  journeyId: IdSchema,
  routeId: IdSchema,
  contributorId: IdSchema,
  contributorToken: z.string(),
  role: JoinRoleSchema,
  isDemo: z.boolean(),
  joinedAtMs: EpochMsSchema,
});
export type JoinJourneyResponse = z.infer<typeof JoinJourneyResponseSchema>;

export const BoardJourneyBodySchema = z.object({ stopId: IdSchema });
export type BoardJourneyBody = z.infer<typeof BoardJourneyBodySchema>;

export const BoardJourneyResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  journeyId: IdSchema,
  routeId: IdSchema,
  contributorId: IdSchema,
  contributorToken: z.string(),
  role: z.literal('passenger'),
  isDemo: z.boolean(),
  boardedStopId: IdSchema,
  boardedAtMs: EpochMsSchema,
  /** First sequence number this (possibly restored) capability should use. */
  nextSeq: z.number().int().nonnegative(),
});
export type BoardJourneyResponse = z.infer<typeof BoardJourneyResponseSchema>;

// ---------------------------------------------------------------------------
// Location ingestion.
// ---------------------------------------------------------------------------

export const LocationReportSchema = z.object({
  /** Increases per contributor. Never restarts at zero under the same capability. */
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lat: LatitudeSchema,
  lon: LongitudeSchema,
  accuracyM: z.number().finite().positive(),
  /** Advisory only. The device clock is never trusted as the server clock. */
  deviceTs: EpochMsSchema,
  /**
   * How old the sample was when it was sent, measured with a monotonic client
   * clock. It stops an ordinary offline backlog from looking fresh; it cannot
   * defend against a deliberately lying client, and nothing here pretends it can.
   */
  sampleAgeMs: z.number().finite().nonnegative().max(24 * 60 * 60 * 1000),
  speedMps: z.number().finite().nonnegative().optional(),
  headingDeg: z.number().finite().min(0).lt(360).optional(),
});
export type LocationReport = z.infer<typeof LocationReportSchema>;

export const LocationBodySchema = z.union([
  LocationReportSchema,
  z.object({ updates: z.array(LocationReportSchema).min(1).max(MAX_BATCH_REPORTS) }),
]);
export type LocationBody = z.infer<typeof LocationBodySchema>;

export const RejectReasonSchema = z.enum([
  'DUPLICATE',
  'OUT_OF_ORDER',
  'TOO_OLD',
  'POOR_ACCURACY',
  'OFF_CORRIDOR',
  'IMPOSSIBLE_MOVEMENT',
  'BACKWARD',
  'CONSENSUS_OUTLIER',
  'AMBIGUOUS_REENTRY',
  'RATE_LIMITED',
]);
export type RejectReason = z.infer<typeof RejectReasonSchema>;

export const ReportDecisionSchema = z.object({
  seq: z.number().int().nonnegative(),
  /** True only after the report was incorporated into committed current state. */
  accepted: z.boolean(),
  reason: RejectReasonSchema.nullable(),
  /** Kept for path reconstruction but deliberately not applied to live state. */
  historyOnly: z.boolean(),
});
export type ReportDecision = z.infer<typeof ReportDecisionSchema>;

export const LocationResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  results: z.array(ReportDecisionSchema),
  serverTs: EpochMsSchema,
  stateVersion: z.number().int().nonnegative(),
});
export type LocationResponse = z.infer<typeof LocationResponseSchema>;

// ---------------------------------------------------------------------------
// Passenger state.
// ---------------------------------------------------------------------------

export const JourneyModeSchema = z.enum([
  'PENDING',
  'LIVE',
  'DWELLING',
  'ESTIMATED',
  'STALE',
  'ENDED',
]);
export type JourneyMode = z.infer<typeof JourneyModeSchema>;

export const PositionSchema = z.object({
  lat: LatitudeSchema,
  lon: LongitudeSchema,
  sM: z.number().finite().nonnegative(),
});
export type Position = z.infer<typeof PositionSchema>;

export const StopEtaSchema = z.object({
  stopId: IdSchema,
  name: z.string(),
  distanceM: z.number().finite().nullable(),
  status: z.enum(['upcoming', 'near', 'passed', 'unknown']),
  etaSeconds: z.number().finite().nonnegative().nullable(),
  etaRangeSeconds: z.tuple([z.number(), z.number()]).nullable(),
  scheduledTs: EpochMsSchema.nullable(),
  basis: z.enum(['live', 'estimated', 'schedule', 'unavailable']),
});
export type StopEta = z.infer<typeof StopEtaSchema>;

export const ProjectionAnchorSchema = z.object({
  confirmedAtMs: EpochMsSchema,
  /** The last confirmed fusion anchor, never an already-projected position. */
  sM: z.number().finite().nonnegative(),
  speedMps: z.number().finite().nonnegative(),
  /** Next unpassed stop, route end, or the travel cap — whichever comes first. */
  capSM: z.number().finite().nonnegative(),
  estimatedAtMs: EpochMsSchema,
  /** Projection freezes here. Never earlier than estimatedAtMs. */
  staleAtMs: EpochMsSchema,
  endedAtMs: EpochMsSchema,
  sigmaM: z.number().finite().nonnegative(),
  /** Row-major 2x2 covariance of [sM, vMps]. */
  covariance: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type ProjectionAnchor = z.infer<typeof ProjectionAnchorSchema>;

export const PublicJourneyEventSchema = z.object({
  id: IdSchema,
  atMs: EpochMsSchema,
  type: z.enum([
    'JOURNEY_STARTED',
    'TRACKING_MODE_CHANGED',
    'POSITION_CORRECTED',
    'JOURNEY_ENDED',
  ]),
  detail: z.object({
    fromMode: JourneyModeSchema.nullable().optional(),
    toMode: JourneyModeSchema.nullable().optional(),
    correctionM: z.number().finite().nullable().optional(),
    reason: z.enum(['driver', 'inactivity', 'max_duration']).nullable().optional(),
  }),
});
export type PublicJourneyEvent = z.infer<typeof PublicJourneyEventSchema>;

export const ActiveSourcesSchema = z.object({
  driver: z.boolean(),
  conductor: z.number().int().nonnegative(),
  passengers: z.number().int().nonnegative(),
});
export type ActiveSources = z.infer<typeof ActiveSourcesSchema>;

export const JourneyStateDtoSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  journeyId: IdSchema,
  routeId: IdSchema,
  routeVersion: z.string(),
  stateVersion: z.number().int().nonnegative(),
  isDemo: z.boolean(),
  mode: JourneyModeSchema,
  /** The current bounded estimate. Null until the first accepted fix. */
  position: PositionSchema.nullable(),
  /** The last position actually confirmed by evidence. Never a projection. */
  lastConfirmedPosition: PositionSchema.nullable(),
  lastConfirmedAtMs: EpochMsSchema.nullable(),
  projection: ProjectionAnchorSchema.nullable(),
  confidenceM: z.number().finite().nonnegative().nullable(),
  speedKmh: z.number().finite().nonnegative().nullable(),
  lastFixAgeSeconds: z.number().finite().nonnegative().nullable(),
  progressFraction: z.number().finite().min(0).max(1).nullable(),
  activeSources: ActiveSourcesSchema,
  /** A stop where fresh, confirmed evidence says boarding is currently possible. */
  boardableStopId: IdSchema.nullable(),
  stops: z.array(StopEtaSchema),
  delaySeconds: z.number().finite().nullable(),
  offRoute: z.boolean(),
  events: z.array(PublicJourneyEventSchema).max(PUBLIC_EVENT_RING),
  serverTs: EpochMsSchema,
});
export type JourneyStateDto = z.infer<typeof JourneyStateDtoSchema>;

export const JourneySummarySchema = z.object({
  journeyId: IdSchema,
  routeId: IdSchema,
  isDemo: z.boolean(),
  mode: JourneyModeSchema,
  startedAtMs: EpochMsSchema,
  lastConfirmedAtMs: EpochMsSchema.nullable(),
  progressFraction: z.number().finite().min(0).max(1).nullable(),
  activeSourceCount: z.number().int().nonnegative(),
});
export type JourneySummary = z.infer<typeof JourneySummarySchema>;

export const JourneyListResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  journeys: z.array(JourneySummarySchema),
  serverTs: EpochMsSchema,
});
export type JourneyListResponse = z.infer<typeof JourneyListResponseSchema>;

export const EndJourneyResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  journeyId: IdSchema,
  mode: z.literal('ENDED'),
  endedAtMs: EpochMsSchema,
  stateVersion: z.number().int().nonnegative(),
});
export type EndJourneyResponse = z.infer<typeof EndJourneyResponseSchema>;

export const RevokeResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  journeyId: IdSchema,
  revoked: z.literal(true),
  stateVersion: z.number().int().nonnegative(),
});
export type RevokeResponse = z.infer<typeof RevokeResponseSchema>;

export { RoleSchema, JoinRoleSchema };
