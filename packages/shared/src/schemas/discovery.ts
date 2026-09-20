import { z } from 'zod';
import {
  IdSchema,
  LatitudeSchema,
  LongitudeSchema,
  SchemaVersionSchema,
} from './common.js';
import { DirectionSchema } from './route.js';
import { JourneyModeSchema, StopEtaSchema } from './journey.js';

/**
 * Stop-first discovery.
 *
 * The route fixtures are the only place stops are defined, and a stop that two
 * routes both serve is authored twice — once per route — because each route
 * needs its own distance along its own line. Passengers do not think that way:
 * "Esplanade" is one place, and the question is which buses call there.
 *
 * So the directory is *derived* from the route registry rather than stored
 * beside it. `key` is the join: a normalised stop name, which is what makes one
 * directory entry able to list several routes. Deriving it means an
 * administrator who adds a route automatically adds its stops to the directory,
 * with no second thing to keep in step.
 */

/** Lower-case, letters and digits only. "Park Street" and "park-street" agree. */
export function stopKey(name: string): string {
  return name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

export const StopRouteRefSchema = z.object({
  routeId: IdSchema,
  code: z.string(),
  color: z.string(),
  name: z.string(),
  origin: z.string(),
  destination: z.string(),
  direction: DirectionSchema,
  /** This route's own identifier for the stop, and its place in the order. */
  stopId: IdSchema,
  sequence: z.number().int().nonnegative(),
  stopCount: z.number().int().positive(),
});
export type StopRouteRef = z.infer<typeof StopRouteRefSchema>;

export const DirectoryStopSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  /** The first-listed route's coordinate for the stop. Good enough to sort by. */
  lat: LatitudeSchema,
  lon: LongitudeSchema,
  routes: z.array(StopRouteRefSchema).min(1),
});
export type DirectoryStop = z.infer<typeof DirectoryStopSchema>;

export const StopDirectoryResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  stops: z.array(DirectoryStopSchema),
});
export type StopDirectoryResponse = z.infer<typeof StopDirectoryResponseSchema>;

/** One route's answer to "when does it reach my stop". */
export const ArrivalSchema = z.object({
  routeId: IdSchema,
  routeVersion: z.string(),
  code: z.string(),
  color: z.string(),
  name: z.string(),
  origin: z.string(),
  destination: z.string(),
  direction: DirectionSchema,

  /** The stop the passenger is waiting at, in this route's own identifiers. */
  boardStopId: IdSchema,
  boardStopName: z.string(),
  /** Where they are going, when they said. Null for a route-only enquiry. */
  alightStopId: IdSchema.nullable(),
  alightStopName: z.string().nullable(),

  /** Null when nothing is currently tracked on this route. */
  journeyId: IdSchema.nullable(),
  isDemo: z.boolean(),
  mode: JourneyModeSchema.nullable(),
  /** The arrival row for the boarding stop, exactly as the journey state gives it. */
  arrival: StopEtaSchema.nullable(),
  lastFixAgeSeconds: z.number().finite().nonnegative().nullable(),
  /** Last stop the bus is known to have reached; the "near X" line. */
  currentStopName: z.string().nullable(),
  /** Stops between the bus and the passenger. Null when the bus is unknown. */
  stopsAway: z.number().int().nonnegative().nullable(),
});
export type Arrival = z.infer<typeof ArrivalSchema>;

export const ArrivalsResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  serverTs: z.number().int(),
  from: z.object({ key: z.string(), name: z.string() }),
  to: z.object({ key: z.string(), name: z.string() }).nullable(),
  arrivals: z.array(ArrivalSchema),
});
export type ArrivalsResponse = z.infer<typeof ArrivalsResponseSchema>;
