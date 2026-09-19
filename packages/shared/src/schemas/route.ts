import { z } from 'zod';
import {
  IdSchema,
  LatitudeSchema,
  LongitudeSchema,
  SchemaVersionSchema,
} from './common.js';

export const DirectionSchema = z.enum(['outbound', 'inbound']);
export type Direction = z.infer<typeof DirectionSchema>;
const RouteColorSchema = z.string().regex(/^#[0-9A-F]{6}$/, 'Use an uppercase six-digit hex colour.');

export const LineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([LongitudeSchema, LatitudeSchema])).min(2),
});

export const RouteStopSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  lat: LatitudeSchema,
  lon: LongitudeSchema,
  /** Distance along the route geometry, metres from the origin. Server-validated. */
  sM: z.number().finite().nonnegative(),
  /**
   * True for the eight first-release checkpoints. False would mark an ordinary
   * stop; the fixture deliberately lists checkpoints only, and the UI says so.
   */
  isSelectedCheckpoint: z.boolean(),
});
export type RouteStop = z.infer<typeof RouteStopSchema>;

export const RouteSegmentSchema = z.object({
  fromSM: z.number().finite().nonnegative(),
  toSM: z.number().finite().nonnegative(),
  /** Authored typical speed for this stretch. Not a measurement. */
  typicalSpeedMps: z.number().finite().positive(),
  /** Allowance for a scheduled pause inside this segment, seconds. */
  dwellAllowanceS: z.number().finite().nonnegative(),
  note: z.string().max(200).optional(),
});
export type RouteSegment = z.infer<typeof RouteSegmentSchema>;

export const RouteProvenanceSchema = z.object({
  /** Where the route identity (code, origin, destination, corridor) came from. */
  officialSource: z.string().min(1),
  officialSourceUrl: z.string().url().nullable(),
  /** Where the coordinates came from, and under what licence. */
  geometrySource: z.string().min(1),
  geometryLicense: z.string().min(1),
  geometrySourceUrl: z.string().url().nullable(),
  /** ISO date the identity was last checked against the official source. */
  verifiedOn: z.string().min(4),
  /**
   * True while the line is a hand-placed corridor approximation rather than a
   * verified road trace. The UI must disclose this wherever the route appears.
   */
  isApproximateGeometry: z.boolean(),
  /** True while stop coordinates are corridor landmarks, not surveyed kerbsides. */
  areStopsApproximate: z.boolean(),
  notes: z.string().max(2000),
});
export type RouteProvenance = z.infer<typeof RouteProvenanceSchema>;

export const RouteScheduleSchema = z.object({
  source: z.string().min(1),
  timezone: z.string().min(1),
  /**
   * True means the times are an illustration, not service times. An illustrative
   * timetable is never displayed as an actual departure or used for delay.
   */
  isIllustrative: z.boolean(),
  departures: z.array(z.string()).max(200),
});
export type RouteSchedule = z.infer<typeof RouteScheduleSchema>;

export const RouteDtoSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdSchema,
  /** Immutable per geometry revision. Active journeys keep the version they began with. */
  version: z.string().min(1),
  code: z.string().min(1).max(16),
  /** Stable categorical colour for this route; never used to communicate status. */
  color: RouteColorSchema,
  name: z.string().min(1).max(120),
  origin: z.string().min(1).max(80),
  destination: z.string().min(1).max(80),
  direction: DirectionSchema,
  timezone: z.string().min(1),
  geometry: LineStringSchema,
  lengthM: z.number().finite().positive(),
  stops: z.array(RouteStopSchema).min(2),
  segments: z.array(RouteSegmentSchema).min(1),
  provenance: RouteProvenanceSchema,
  schedule: RouteScheduleSchema.nullable(),
});
export type RouteDto = z.infer<typeof RouteDtoSchema>;

/** The shape stored in `data/routes/*.json`; `lengthM` and stop `sM` are derived. */
export const RouteFixtureSchema = RouteDtoSchema.omit({
  schemaVersion: true,
  lengthM: true,
  segments: true,
}).extend({
  stops: z
    .array(RouteStopSchema.omit({ sM: true }).extend({ sM: z.number().optional() }))
    .min(2),
  /**
   * Segments are authored between checkpoints, not between distances, so that a
   * coordinate edit cannot leave the speed table pointing at the wrong stretch of
   * road. The distances are derived when the fixture is prepared.
   */
  segments: z
    .array(
      z.object({
        fromStopId: IdSchema,
        toStopId: IdSchema,
        typicalSpeedMps: z.number().finite().positive(),
        dwellAllowanceS: z.number().finite().nonnegative(),
        note: z.string().max(200).optional(),
      }),
    )
    .min(1),
});
export type RouteFixture = z.infer<typeof RouteFixtureSchema>;

export const RouteSummarySchema = z.object({
  id: IdSchema,
  version: z.string(),
  code: z.string(),
  color: RouteColorSchema,
  name: z.string(),
  origin: z.string(),
  destination: z.string(),
  direction: DirectionSchema,
  lengthM: z.number().nullable(),
  stopCount: z.number().int().nonnegative(),
  isApproximateGeometry: z.boolean(),
  trackingAvailable: z.boolean(),
  verificationStatus: z.enum(['geometry-available', 'geometry-missing']),
  listedOrigin: z.string(),
  listedDestination: z.string(),
  officialSourceUrl: z.string().url(),
  retrievedOn: z.string(),
  missing: z.string().nullable(),
});
export type RouteSummary = z.infer<typeof RouteSummarySchema>;

export const RouteListResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  routes: z.array(RouteSummarySchema),
});
export type RouteListResponse = z.infer<typeof RouteListResponseSchema>;

export const RouteCatalogueEntrySchema = z.object({
  id: IdSchema,
  code: z.string().min(1).max(16),
  color: RouteColorSchema,
  name: z.string().min(1).max(120),
  origin: z.string().min(1).max(80),
  destination: z.string().min(1).max(80),
  listedOrigin: z.string().min(1).max(120),
  listedDestination: z.string().min(1).max(120),
  direction: DirectionSchema,
  activeVersion: z.string().nullable(),
  officialSourceUrl: z.string().url(),
  retrievedOn: z.string(),
  missing: z.string().nullable(),
});
export type RouteCatalogueEntry = z.infer<typeof RouteCatalogueEntrySchema>;

export const RouteCatalogueSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  routes: z.array(RouteCatalogueEntrySchema).min(1),
});
