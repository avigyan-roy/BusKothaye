import { z } from 'zod';
import { EpochMsSchema, IdSchema, SchemaVersionSchema } from './common.js';

export const DemoFleetConfigSchema = z.object({
  routeId: IdSchema,
  startStopId: IdSchema.nullable(),
  endStopId: IdSchema.nullable(),
  /** A realistic city-demo band; zero-speed scenarios use the explicit pause control. */
  speedKmh: z.number().finite().min(5).max(50),
  busCount: z.number().int().min(1).max(10),
  sourcesPerBus: z.number().int().min(1).max(5),
  cadenceMs: z.number().int().min(3000).max(60_000),
  noiseM: z.number().finite().min(0).max(100),
  dwellSeconds: z.number().int().min(0).max(300),
  loop: z.boolean(),
  paused: z.boolean(),
  outage: z.boolean(),
});
export type DemoFleetConfig = z.infer<typeof DemoFleetConfigSchema>;

export const DemoAuditEntrySchema = z.object({
  id: IdSchema,
  atMs: EpochMsSchema,
  accountId: IdSchema,
  username: z.string(),
  action: z.enum(['TURNED_ON', 'TURNED_OFF', 'UPDATED', 'RESET']),
});
export type DemoAuditEntry = z.infer<typeof DemoAuditEntrySchema>;

export const DemoControlDtoSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  revision: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  status: z.enum(['OFF', 'STARTING', 'ON', 'STOPPING']),
  config: DemoFleetConfigSchema,
  activeJourneyCount: z.number().int().nonnegative(),
  updatedAtMs: EpochMsSchema,
  audit: z.array(DemoAuditEntrySchema).max(20),
});
export type DemoControlDto = z.infer<typeof DemoControlDtoSchema>;

export const DemoSwitchBodySchema = z.object({
  enabled: z.boolean(),
  config: DemoFleetConfigSchema.partial().optional(),
});

export const DemoUpdateBodySchema = DemoFleetConfigSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one setting is required.',
);
