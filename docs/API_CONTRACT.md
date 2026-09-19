# Shared API contract

Implement this contract in `packages/shared/src/` as Zod runtime schemas with inferred TypeScript types. Frontend, API, and simulator import those definitions. This document supersedes conflicting examples in the original plan.

## Conventions

- Prefix application endpoints with `/v1`. JSON throughout; epoch milliseconds for timestamps, metres for distance, metres/second internally for speed, `[longitude, latitude]` in GeoJSON.
- Every journey belongs to an immutable route version. Default route ID: `ac24-patuli-howrah`; direction: `outbound`. Never reuse a live journey after changing its geometry.
- IDs are opaque strings. Capability tokens go in `Authorization: Bearer …`, never a URL. Join codes go in POST bodies.
- Account sessions also use `Authorization: Bearer …`. An account session proves the signed-in account and selected role; a journey contributor capability authorizes location ingestion for one journey. They are not interchangeable.
- Return `Cache-Control: no-store` for live state, auth responses, and diagnostics. Static route responses may use an ETag based on route version.
- Public reads expose fused journey information only. No contributor IDs/coordinates, capability hashes, join codes, or request headers in public payloads.
- Use `null` for unavailable data. Do not turn missing GPS into coordinates `[0,0]`, or missing ETA into an arrival of zero minutes.
- All response DTOs include `schemaVersion: 1` where applicable. Breaking changes require coordinated updates to all consumers and docs.

## Endpoints

| Method/path | Access | Behaviour |
| --- | --- | --- |
| `GET /health` | Public | Process liveness; independent of external AWS calls |
| `GET /ready` | Public | Minimal ready/not-ready response; no secrets or internal diagnostics |
| `POST /v1/auth/register` | Public | Create a community account with passenger, driver, or conductor role; cannot grant admin |
| `POST /v1/auth/login` | Public | Verify username/password and issue an account session |
| `GET /v1/auth/me` | Account session | Return the current account, including server-owned `isAdmin` |
| `PUT /v1/auth/role` | Community account session | Change transport role; never changes administrator access |
| `PUT /v1/auth/password` | Community account session | Verify the current password, rotate its hash, and issue a new session |
| `POST /v1/auth/logout` | Account session | Delete the current account session |
| `GET /v1/routes` | Public | Available route summaries; only AC24 required initially |
| `GET /v1/routes/:routeId` | Public | Full route, selected stops, provenance, and any verified schedule |
| `GET /v1/routes/:routeId/journeys` | Public | Non-expired, non-ended journeys; includes `isDemo` and mode |
| `GET /v1/admin/routes` | Administrator account | List editable active route fixtures with update audit metadata |
| `PUT /v1/admin/routes/:routeId` | Administrator account | Validate, persist, and activate a new immutable route revision |
| `POST /v1/journeys` | Driver account or simulator, rate limited | Create journey and issue driver + ops capabilities and join code |
| `POST /v1/journeys/:id/contributors` | Matching account role + join code | Join as passenger or conductor; never grants driver or ops rights |
| `POST /v1/journeys/:id/board` | Passenger account, current boardable stop | Board without a join code and issue/restore a passenger capability |
| `POST /v1/journeys/:id/locations` | Contributor/driver capability | Submit a single report or bounded batch |
| `DELETE /v1/journeys/:id/contributors/me` | Contributor/driver capability | Revoke own sharing capability and stop contributing |
| `POST /v1/journeys/:id/end` | Owner account or active conductor account | Durably end journey; repeated valid end requests are idempotent |
| `GET /v1/journeys/:id/state` | Public | Complete passenger DTO, projected at server read time |
| `GET /v1/journeys/:id/debug` | Driver or read-only ops capability | Bounded diagnostics; protected even for demo journeys |
| `GET /v1/demo` | Administrator account | Read fleet status, validated dispatch config, and bounded audit trail |
| `PUT /v1/demo` | Administrator account | Dispatch or end the fleet; enabling may include a full/partial config |
| `PATCH /v1/demo` | Administrator account | Change one or more dispatch settings |
| `POST /v1/demo/reset` | Administrator account | Fence/end the current fleet and reset its active generation |
| `GET /v1/demo/worker/control` | Simulator service identity | Read current control state |
| `POST /v1/demo/worker/lease` | Simulator service identity | Acquire/refresh the single-worker generation lease |

The driver uses separate controls for **Pause location sharing** (stop watch without revoking driver control) and **End journey**. Do not accidentally revoke the only driver capability when the driver merely pauses GPS. Passenger/conductor **Stop sharing** clears the watcher, queue, and own capability via DELETE.

### Route administration

The save body is `{ route: RouteFixture }`, using the same runtime schema as files in `data/routes/`. The path route ID and body ID must match. An update to an existing route must use a new version string; the server rejects reuse of the active version. Before the durable write it derives route length and stop distances, checks stop ordering and line proximity, validates contiguous segments, and validates a non-illustrative timetable has departures.

The web editor may use Google Maps to propose a road-following path, but Google does not decide the verification flags. The administrator must explicitly record whether the full alignment and boarding-point pins were reviewed. The public route endpoint immediately serves the activated revision. Existing journeys stay bound to their route version.

## Accounts and administrator bootstrap

Community registration accepts only `passenger`, `driver`, or `conductor`.
`AccountDto.isAdmin` is server-owned: ignore any attempted `isAdmin` registration
field, and never derive administrator access from the selected transport role.
Password records use a password KDF; account sessions and capability tokens are
stored as hashes.

At process startup, create the configured administrator if its normalized
username does not exist. In development, omitted settings mean `admin` / `admin`.
Production requires both `ADMIN_USERNAME` and `ADMIN_PASSWORD`, requires at
least 12 password characters, and rejects the development pair. These are
server-only settings and must never use a `VITE_*` prefix. If the username
already belongs to a non-admin account, startup fails rather than promoting it.
An existing persisted administrator keeps its current password; changing the
bootstrap environment does not silently rotate it.

The password visibility checkbox is entirely a browser presentation control: it
switches the current input between password and text display and never reads a
stored password from the server.

## Creation, joining, and boarding

Create body: `{ routeId }`. A signed-in community account must currently have
the driver role. `isDemo` is never client-selected: the server derives it from
the private simulator service identity, and simulator creation is accepted only
while the shared fleet control is ON. Bind the route's direction/version on
creation. Response `201`:

```ts
interface CreateJourneyResponse {
  schemaVersion: 1;
  journeyId: string;
  routeId: string;
  routeVersion: string;
  contributorId: string;
  contributorToken: string; // driver capability
  opsToken: string;         // separate, read-only debug capability
  joinCode: string;
  role: 'driver';
  isDemo: boolean;
  createdAtMs: number;
}
```

Join body: `{ joinCode: string, role: 'passenger' | 'conductor' }`. Require a
community account whose currently selected role matches the requested role.
Return `201` with `contributorId`, `contributorToken`, `journeyId`, and the
granted `role`. All joiners have the same maximum trust ceiling initially: a
self-selected conductor label is not proof of authority.

Use a readable code such as `BUS-7K4M9Q` and a link containing only the journey ID, such as `/drive?journey=<id>`. A person following it enters the join code. Provide copy buttons that actually use the Clipboard API with a fallback.

Create, join, and board POST requests accept an `Idempotency-Key` header. Bound
its lifetime and persist the mapping in DynamoDB mode. A replay must not create a
second journey or contributor. Store only token hashes; if a creation succeeded
but its one-time token response was lost, a replay returns a clear
`409 CAPABILITY_RESPONSE_UNAVAILABLE` referencing the existing journey and does
not silently issue different tokens. The UI offers a deliberate new attempt;
abandoned pending journeys expire. Test concurrent use of the same key.

Board body: `{ stopId: string }`. Boarding has no join code, but it requires a
signed-in passenger account and succeeds only when `boardableStopId` in the
current server-derived state equals the requested stop. That value comes from
fresh, confirmed evidence near the stop; a bounded prediction alone cannot make
a stop boardable. If the bus has moved, return `409 BOARDING_UNAVAILABLE`.

On success, return `201` with `journeyId`, `routeId`, `contributorId`, a one-time
`contributorToken`, role `passenger`, `isDemo`, `boardedStopId`, `boardedAtMs`,
and `nextSeq`. Reboarding by the same active passenger rotates/restores that
passenger's capability rather than creating a duplicate source. Marking boarded
does not start browser geolocation; the user must separately consent to location
sharing, and leaving revokes the contributor capability.

## Administrator-controlled fleet

The dispatch config contains `routeId`, nullable `startStopId` and `endStopId`,
`speedKmh`, `busCount`, `sourcesPerBus`, `cadenceMs`, `noiseM`, `dwellSeconds`,
`loop`, `paused`, and `outage`. Enforce the shared schema bounds, including a
5–50 km/h speed range. The selected route must have tracking geometry, both
checkpoint IDs must belong to it, and a selected destination must occur after
the selected start.

Only an authenticated account with server-owned `isAdmin=true` may read or
mutate `/v1/demo`. Passenger, driver, and conductor roles do not grant access.
The worker uses a distinct private `SIMULATOR_TOKEN`, polls the control state,
and acquires a short generation-scoped lease. Turning the fleet off increments
the generation before ending active simulated journeys so in-flight worker
requests are fenced. Retain at most 20 audit entries with action, account ID,
username, and server time; never include the administrator password or session
token.

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
  | 'BACKWARD' | 'CONSENSUS_OUTLIER' | 'AMBIGUOUS_REENTRY'
  | 'RATE_LIMITED';

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

Define `RouteDto` with: `id`, `version`, `code`, `color`, `name`, `origin`,
`destination`, `direction`, `timezone`, `geometry` (GeoJSON LineString),
`lengthM`, `stops`, `segments`, and `provenance`. `color` is an uppercase
six-digit hex value used consistently for that route in the directory and map;
it is categorical decoration and must never carry status by itself. Route
summaries and catalogue entries include the same field, including entries whose
tracking geometry is unavailable.

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
  boardableStopId: string | null; // confirmed, fresh stop where boarding is allowed
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
