import { z } from 'zod';
import {
  DEBUG_DECISION_RING,
  DEBUG_EVENT_RING,
  DEBUG_SOURCE_LIMIT,
} from '../constants.js';
import { EpochMsSchema, IdSchema, RoleSchema, SchemaVersionSchema } from './common.js';
import { JourneyModeSchema, RejectReasonSchema } from './journey.js';

/**
 * Diagnostics. Protected by the driver or the read-only ops capability, for demo
 * journeys too. Source labels are journey-local pseudonyms — never a device ID,
 * a token, a token hash, or a raw request body.
 */

export const DebugSourceSchema = z.object({
  /** Journey-local pseudonym such as "source-3". Not stable across journeys. */
  label: z.string(),
  role: RoleSchema,
  joinedAtMs: EpochMsSchema,
  lastReportAtMs: EpochMsSchema.nullable(),
  lastAcceptedAtMs: EpochMsSchema.nullable(),
  ageSeconds: z.number().finite().nonnegative().nullable(),
  lastAccuracyM: z.number().finite().nonnegative().nullable(),
  lastProjectedSM: z.number().finite().nullable(),
  lastOffsetM: z.number().finite().nonnegative().nullable(),
  /** Share of the fused estimate this source last carried, 0–1. */
  weightShare: z.number().finite().min(0).max(1).nullable(),
  reputation: z.number().finite().min(0).max(1),
  acceptedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  lastDecision: RejectReasonSchema.nullable(),
  isLive: z.boolean(),
});
export type DebugSource = z.infer<typeof DebugSourceSchema>;

export const DebugDecisionSchema = z.object({
  atMs: EpochMsSchema,
  sourceLabel: z.string(),
  seq: z.number().int().nonnegative(),
  accepted: z.boolean(),
  reason: RejectReasonSchema.nullable(),
  historyOnly: z.boolean(),
  projectedSM: z.number().finite().nullable(),
  offsetM: z.number().finite().nonnegative().nullable(),
});
export type DebugDecision = z.infer<typeof DebugDecisionSchema>;

export const DebugEventSchema = z.object({
  id: IdSchema,
  atMs: EpochMsSchema,
  kind: z.string(),
  detail: z.string().max(400),
});
export type DebugEvent = z.infer<typeof DebugEventSchema>;

export const DebugDtoSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  journeyId: IdSchema,
  routeId: IdSchema,
  routeVersion: z.string(),
  stateVersion: z.number().int().nonnegative(),
  isDemo: z.boolean(),
  mode: JourneyModeSchema,
  anchor: z
    .object({
      sM: z.number().finite(),
      speedMps: z.number().finite(),
      sigmaM: z.number().finite(),
      covariance: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      confirmedAtMs: EpochMsSchema,
    })
    .nullable(),
  offRoute: z.boolean(),
  ambiguity: z.string().nullable(),
  sources: z.array(DebugSourceSchema).max(DEBUG_SOURCE_LIMIT),
  decisions: z.array(DebugDecisionSchema).max(DEBUG_DECISION_RING),
  events: z.array(DebugEventSchema).max(DEBUG_EVENT_RING),
  storage: z.object({
    driver: z.enum(['memory', 'dynamodb']),
    lastWriteOk: z.boolean(),
    writeConflicts: z.number().int().nonnegative(),
    droppedDiagnostics: z.number().int().nonnegative(),
  }),
  serverTs: EpochMsSchema,
});
export type DebugDto = z.infer<typeof DebugDtoSchema>;
