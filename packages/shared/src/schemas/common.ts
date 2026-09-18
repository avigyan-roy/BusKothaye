import { z } from 'zod';
import { SCHEMA_VERSION } from '../constants.js';

/** Opaque identifier. Never parsed for meaning by a client. */
export const IdSchema = z.string().min(1).max(128);

/** Epoch milliseconds. The only timestamp format on the wire. */
export const EpochMsSchema = z.number().int().finite();

export const LatitudeSchema = z.number().finite().min(-90).max(90);
export const LongitudeSchema = z.number().finite().min(-180).max(180);

export const SchemaVersionSchema = z.literal(SCHEMA_VERSION);

/** Error codes the API can return. Clients switch on the code, not the message. */
export const ErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'ROUTE_NOT_FOUND',
  'JOURNEY_NOT_FOUND',
  'JOIN_CODE_INVALID',
  'USERNAME_TAKEN',
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'ROUTE_UNAVAILABLE',
  'DEMO_DISABLED',
  'JOURNEY_FULL',
  'JOURNEY_ENDED',
  'CONFLICT',
  'CAPABILITY_RESPONSE_UNAVAILABLE',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'STORAGE_UNAVAILABLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    /** Safe for display. Never contains a stack trace or the rejected value. */
    message: z.string(),
    requestId: z.string(),
    /** Field-level detail for validation failures: path plus a safe reason. */
    fields: z
      .array(z.object({ path: z.string(), reason: z.string() }))
      .max(24)
      .optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const RoleSchema = z.enum(['driver', 'conductor', 'passenger']);
export type Role = z.infer<typeof RoleSchema>;

/** Roles a join code may grant. A join never produces a driver. */
export const JoinRoleSchema = z.enum(['conductor', 'passenger']);
export type JoinRole = z.infer<typeof JoinRoleSchema>;
