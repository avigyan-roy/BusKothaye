# Shared API contract

Implement this contract in `packages/shared/src/` as Zod runtime schemas with inferred TypeScript types. Frontend, API, and simulator import those definitions. This document supersedes conflicting examples in the original plan.

## Conventions

- Prefix application endpoints with `/v1`. JSON throughout; epoch milliseconds for timestamps, metres for distance, metres/second internally for speed, `[longitude, latitude]` in GeoJSON.
- Every journey belongs to an immutable route version. Default route ID: `ac24-patuli-howrah`; direction: `outbound`. Never reuse a live journey after changing its geometry.
- IDs are opaque strings. Capability tokens go in `Authorization: Bearer …`, never a URL. Join codes go in POST bodies.
- Return `Cache-Control: no-store` for live state, auth responses, and diagnostics. Static route responses may use an ETag based on route version.
- Public reads expose fused journey information only. No contributor IDs/coordinates, capability hashes, join codes, or request headers in public payloads.
- Use `null` for unavailable data. Do not turn missing GPS into coordinates `[0,0]`, or missing ETA into an arrival of zero minutes.
- All response DTOs include `schemaVersion: 1` where applicable. Breaking changes require coordinated updates to all consumers and docs.

## Endpoints

| Method/path | Access | Behaviour |
| --- | --- | --- |
| `GET /health` | Public | Process liveness; independent of external AWS calls |
| `GET /ready` | Public | Minimal ready/not-ready response; no secrets or internal diagnostics |
| `GET /v1/routes` | Public | Available route summaries; only AC24 required initially |
| `GET /v1/routes/:routeId` | Public | Full route, selected stops, provenance, and any verified schedule |
| `GET /v1/routes/:routeId/journeys` | Public | Non-expired, non-ended journeys; includes `isDemo` and mode |
| `POST /v1/journeys` | Public, rate limited | Create journey and issue driver + ops capabilities and join code |
| `POST /v1/journeys/:id/contributors` | Join code | Join as passenger or conductor; never grants driver or ops rights |
| `POST /v1/journeys/:id/locations` | Contributor/driver capability | Submit a single report or bounded batch |
| `DELETE /v1/journeys/:id/contributors/me` | Contributor/driver capability | Revoke own sharing capability and stop contributing |
| `POST /v1/journeys/:id/end` | Driver capability | Durably end journey; repeated valid end requests are idempotent |
| `GET /v1/journeys/:id/state` | Public | Complete passenger DTO, projected at server read time |
| `GET /v1/journeys/:id/debug` | Driver or read-only ops capability | Bounded diagnostics; protected even for demo journeys |

The driver uses separate controls for **Pause location sharing** (stop watch without revoking driver control) and **End journey**. Do not accidentally revoke the only driver capability when the driver merely pauses GPS. Passenger/conductor **Stop sharing** clears the watcher, queue, and own capability via DELETE.

## Creation and joining

Create body: `{ routeId, isDemo?: boolean }`. Default `isDemo=false`; a simulator always sets it to `true`. Bind the route's direction/version on creation. Response `201`:

```ts
interface CreateJourneyResponse {
  schemaVersion: 1;
  journeyId: string;
  routeId: string;
  contributorId: string;
  contributorToken: string; // driver capability
  opsToken: string;         // separate, read-only debug capability
  joinCode: string;
  role: 'driver';
  isDemo: boolean;
  createdAtMs: number;
}
```

Join body: `{ joinCode: string, role: 'passenger' | 'conductor' }`. Return `201` with `contributorId`, `contributorToken`, `journeyId`, and the granted `role`. All joiners have the same maximum trust ceiling initially: a self-selected conductor label is not proof of authority.

Use a readable code such as `BUS-7K4M9Q` and a link containing only the journey ID, such as `/drive?journey=<id>`. A person following it enters the join code. Provide copy buttons that actually use the Clipboard API with a fallback.

Create/join POST requests accept an `Idempotency-Key` header. Bound its lifetime and persist the mapping in DynamoDB mode. A replay must not create a second journey or contributor. Store only token hashes; if a creation succeeded but its one-time token response was lost, a replay returns a clear `409 CAPABILITY_RESPONSE_UNAVAILABLE` referencing the existing journey and does not silently issue different tokens. The UI offers a deliberate new attempt; abandoned pending journeys expire. Test concurrent use of the same key.

## Location ingestion

```ts
interface LocationReport {
  seq: number;             // nonnegative safe integer, increasing per contributor
  lat: number;             // [-90,90], finite
  lon: number;             // [-180,180], finite
  accuracyM: number;       // finite and >0
  deviceTs: number;        // advisory timestamp, never trusted as the server clock
  sampleAgeMs: number;     // nonnegative age at sending, measured with a monotonic client clock
  speedMps?: number;       // optional nonnegative finite value, advisory
  headingDeg?: number;    // [0,360), advisory
}
type LocationBody = LocationReport | { updates: LocationReport[] };

type RejectReason =
  | 'DUPLICATE' | 'OUT_OF_ORDER' | 'TOO_OLD'
  | 'POOR_ACCURACY' | 'OFF_CORRIDOR' | 'IMPOSSIBLE_MOVEMENT'
  | 'BACKWARD' | 'CONSENSUS_OUTLIER' | 'AMBIGUOUS_REENTRY';

interface ReportDecision {
  seq: number;
  accepted: boolean;       // eligible report was incorporated into committed current state
  reason: RejectReason | null;
  historyOnly: boolean;
}
```

Return `202 { results: ReportDecision[], serverTs, stateVersion }` for both single and batch forms. Results are in input order. A malformed body is `400`, not a fake accepted report. An unauthenticated report is `401`, not `202`.

Maximum batch: 60 reports; maximum body: 64 KiB. Persist/report historical decisions separately. Only the newest eligible report in a batch may update live state. A newest report more than 10 seconds old is historical too. `sampleAgeMs` is client-reported and cannot defeat deliberate spoofing; it prevents ordinary offline backlog from looking fresh. Sequence checks and movement checks still apply.

Persist sequence progress with the contributor snapshot. Keep sequence in session storage for a resumed capability, or issue a new contributor on a fresh session; do not restart sequence zero under the same capability. Reject duplicates without applying the filter twice.

## Route DTO

Define `RouteDto` with: `id`, `version`, `code`, `name`, `origin`, `destination`, `direction`, `timezone`, `geometry` (GeoJSON LineString), `lengthM`, `stops`, `segments`, and `provenance`.

Each stop includes `id`, `name`, `lat`, `lon`, `sM`, and `isSelectedCheckpoint`. Selected checkpoints are a subset of stops, not a claim to list every official stop. Segment defaults include typical speed and dwell allowance. The server computes/validates cumulative distances; clients do not maintain another route definition.

`provenance` records official route source, geometry source/license, verification date, and whether geometry is a demonstration approximation. Schedule is nullable; if present include source, timezone, and `isIllustrative`. Never display an illustrative timetable as actual service times.

## Passenger state

```ts
type JourneyMode = 'PENDING' | 'LIVE' | 'DWELLING' | 'ESTIMATED' | 'STALE' | 'ENDED';
interface Position { lat: number; lon: number; sM: number }
interface StopEta {
  stopId: string;
  name: string;
  distanceM: number | null;
  status: 'upcoming' | 'near' | 'passed' | 'unknown';
  etaSeconds: number | null;
  etaRangeSeconds: [number, number] | null;
  scheduledTs: number | null;
  basis: 'live' | 'estimated' | 'schedule' | 'unavailable';
}
interface ProjectionAnchor {
  confirmedAtMs: number;
  sM: number;             // last confirmed fusion anchor, not already-projected position
  speedMps: number;       // actual speed used by the common projection function
  capSM: number;          // next stop, route end, or maximum travel cap
  estimatedAtMs: number;
  staleAtMs: number;      // no earlier than estimatedAtMs; horizon/cap rule below
  endedAtMs: number;      // automatic end threshold without new evidence
  sigmaM: number;
  covariance: [number, number, number, number]; // row-major 2x2
}
interface JourneyStateDto {
  schemaVersion: 1;
  journeyId: string;
  routeId: string;
  routeVersion: string;
  stateVersion: number;
  isDemo: boolean;
  mode: JourneyMode;
  position: Position | null;
  lastConfirmedPosition: Position | null;
  lastConfirmedAtMs: number | null;
  projection: ProjectionAnchor | null;
  confidenceM: number | null;
  speedKmh: number | null;
  lastFixAgeSeconds: number | null;
  progressFraction: number | null;
  activeSources: { driver: boolean; conductor: number; passengers: number };
  stops: StopEta[];
  delaySeconds: number | null;
  offRoute: boolean;
  events: PublicJourneyEvent[]; // maximum 20, sanitized; define the schema
  serverTs: number;
}
```

`position` is the current bounded estimate. `lastConfirmedPosition` retains the confirmed anchor. Pending position/projection/ETA fields are null. Ended state keeps its final position but has no moving projection. At a predicted stop arrival, status stays `near`; only accepted evidence can mark it `passed`.

Fresh evidence takes precedence over a projection cap: a bus stopped at a stop can still be LIVE/DWELLING. Set `staleAtMs = max(estimatedAtMs, min(confirmedAtMs + 90_000, capReachedAtMs))`, using an infinite cap-arrival time if speed is zero and the cap has not been reached. Clamp `capSM` to at least the anchor's `sM`, so a not-yet-confirmed stop-pass margin cannot move the marker backward.

Define a small public event union (`JOURNEY_STARTED`, `TRACKING_MODE_CHANGED`, `POSITION_CORRECTED`, `JOURNEY_ENDED`) with `id`, `atMs`, and safe structured details. Do not serialize internal diagnostic strings into public events. Derive time-based transitions deterministically; repeated GET requests must not append duplicate events or change state versions.

## Debug response

Define `DebugDto` separately. Include state version, fusion anchor/covariance, at most 24 active source summaries, last 100 report decisions, and a bounded event ring. Source labels are journey-local pseudonyms. Never include bearer tokens, hashes, full request bodies, or unbounded history. Expose storage health only here or in private logs.

## Errors and headers

```json
{
  "error": {
    "code": "JOIN_CODE_INVALID",
    "message": "Check the join code and try again.",
    "requestId": "opaque-request-id"
  }
}
```

Use `400` invalid input, `401` missing/invalid capability, `403` wrong privilege, `404` unknown route/journey, `409` conflict, `410` expired/ended write, `413` body too large, `429` rate limit with `Retry-After`, and `503` durable-state unavailable or exhausted write retries. Return safe field errors without stack traces or raw rejected values. Public errors must not reveal whether a token hash exists.
