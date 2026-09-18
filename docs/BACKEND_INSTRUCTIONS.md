# Backend build instructions

Read [the API contract](API_CONTRACT.md), [decisions](DECISIONS.md), and [route brief](ROUTE_AND_CONTENT.md) first. Build a real Node/Express service, not static JSON pretending to be a backend.

## Structure and boundaries

- `app.ts` creates the Express app without listening; `server.ts` validates configuration and binds `0.0.0.0:${PORT}`.
- `routes/` owns HTTP validation and response mapping; business rules live outside route handlers.
- `fusion/` contains pure geometry gates, consensus, filter, ETA, and journey transitions. No Express/AWS imports; no `Date.now()` inside the engine.
- `store/` implements one repository interface with memory and DynamoDB adapters. Both support atomic versioned transitions.
- `auth/` generates capabilities, verifies privilege, hashes tokens, and limits attempts.
- `observability/` writes structured sanitized logs and metrics.
- Import schemas/constants from shared packages. Do not duplicate coordinate math in the API, browser, and simulator.

Use strict TypeScript, explicit units in names, bounded arrays, request IDs, centralized error handling, and an injected clock. Add comments that explain a mathematical or product choice, not comments that repeat code.

## Lifecycle and privileges

Create a journey in `PENDING`, bound to a known AC24 route version. No position exists yet. Generate random 32-byte driver and ops capabilities, retain hashes only, and return plaintext once. Hash the join code too. A driver has ingestion/end/debug rights; an ops capability can only read debug. Other contributors can only report and revoke themselves.

Joining with a code never creates a driver. A user choosing “conductor” is not verified, so it must not grant greater authority or a higher trust ceiling than passenger membership. Maximum 24 simultaneous contributors; reject additional joins cleanly.

Persist lifecycle changes before acknowledging them in DynamoDB mode. End/revoke must remain effective across a restart. Ending revokes ingestion and join access; the driver can repeat end idempotently for a bounded 24-hour tombstone period. Ops read access may remain for 24 hours so the team can inspect a completed demo. Do not retain an unlimited valid debug token.

Implement the creation/join idempotency contract. Public demo creation is still rate limited. A driver role represents control of this app's journey, not proof that the person operates a WBTC bus.

## Ingestion pipeline

1. Validate body, limits, capability, journey expiry, and privilege.
2. Read the latest authoritative snapshot and version.
3. Check contributor sequence/dedup state, age, numeric ranges, and reported accuracy.
4. For a batch, select at most the newest fresh eligible report for live fusion; retain older reports as history-only. Never replay the backlog into current state one by one.
5. Project to route distance using local metric geometry. Use an elapsed-time-based candidate window; do not lock recovery to 600 metres.
6. Apply corridor, movement, backward-motion, continuity, and consensus gates.
7. Fuse fresh per-source samples at a common reference time; perform one valid filter update, then compute derived status.
8. Conditionally persist the complete next snapshot. On conflict, reload and recompute the entire pure transition, including permission and sequence checks. Retry at most four times with jitter; then return retryable `503`.
9. After commit, queue bounded accepted/rejected diagnostic records. Return the committed decision, version, and server time.

Malformed/auth failures use HTTP errors. Well-formed but unusable GPS yields `202` with `accepted:false` and an explicit reason. A storage error must never return `accepted:true`.

## Time and measurement handling

Use server receive time as the reference and subtract bounded `sampleAgeMs` for ordinary buffered-report age handling. `deviceTs`, reported speed, and heading are advisory. Reject known stale data; do not let an untrusted clock change system time. Client-controlled sample age cannot authenticate freshness against a malicious client; document the limit.

Per-source freshness expires after 10 seconds. Align recent measurements to a common reference time using a bounded velocity model or an explicitly documented conservative alternative. Do not repeatedly re-assimilate the same old source measurements as independent new observations and artificially shrink confidence. Cover different source cadences in tests.

Use a monotonic elapsed-time abstraction where practical, with epoch timestamps for serialization. Clamp negative durations and handle clock discontinuities conservatively. User phone wall-clock skew must not alter animation or filter timing.

## Geometry and consensus

- Load one canonical route fixture; verify finite coordinates, nonzero segments, ordered stop distances, and stops within 30m of the geometry.
- Project in metres using an appropriate local coordinate approximation or a small tested geometry library. Never do Euclidean distance directly on latitude/longitude degrees.
- Normal projection search is bounded by elapsed time, maximum speed, and backward tolerance. After a long gap, expand it before applying gates. Different route directions need different geometry.
- For three or more sources, identify an unweighted median/MAD majority cluster first. Then combine surviving measurements with bounded accuracy/freshness/reputation weights; cap one source's share at 45% when at least three survive.
- A rejected outlier is not accepted merely because it passed the corridor check. Persist `CONSENSUS_OUTLIER`, reduce reputation modestly, and exclude it from the live anchor.
- Two disagreeing sources cannot establish a trustworthy majority. Prefer continuity with the confirmed trajectory, widen uncertainty, and require confirmation for a large change. A lone fresh source can track, with a conservative confidence floor.
- When two comparable clusters remain, emit a diagnostic ambiguity and hold the conservative estimate rather than averaging two buses into the space between them.
- Repeated valid updates can restore reputation gradually. Do not automatically expel a contributor after three noisy fixes; offer useful feedback and allow recovery.

Use a constant-velocity Kalman filter on `[sM, vMps]` with a stable covariance update and finite/positive-variance checks. The EWMA fallback from the original plan is permitted only if explicitly recorded and tested against the same scenarios. Never quietly replace confidence with an arbitrary decorative number.

## Initial configurable thresholds

Keep these in `packages/shared/src/constants.ts`, with explanations and units. Tune only with recorded test evidence.

| Constant | Initial value |
| --- | --- |
| GPS accuracy floor / rejection | 5m / 100m |
| Corridor | 60m + reported accuracy |
| Maximum speed | 25m/s (90km/h) |
| Backward tolerance | 30m |
| Freshness decay / live timeout | 10s / 10s |
| Projection horizon / travel cap | 90s / 600m |
| Stop-pass confirmation margin | 15m beyond stop with accepted evidence |
| Dwell detection | 30s of fresh evidence consistent with being stationary |
| Automatic end without accepted fixes | 300s from last accepted fix; from creation if pending |
| Maximum journey duration | 6h |
| Contributor cadence | About 3s between uploads |
| Request/batch/body limits | 5 requests/s/token; 60 reports; 64 KiB |
| Contribution processing ceiling | At most 1 live measurement/s/source; permit normal retries/batches |

The simulator must obey the same gates and rate limits. Set separate configurable create/join limits per IP and per journey, with burst allowance for a team sharing Wi-Fi. Configure trusted proxies correctly; do not blindly trust user-supplied forwarding headers.

## State machine and bounded projection

`PENDING → LIVE` on the first incorporated fix. Fresh stationary evidence can produce `DWELLING`. Both `LIVE` and `DWELLING` degrade to `ESTIMATED` at 10 seconds without an accepted fix, then `STALE` at the earlier of 90 seconds or reaching the projection cap. At 300 seconds without accepted evidence the journey expires to `ENDED`. Explicit driver end works from every active state.

Use the last confirmed fusion state as the projection anchor. Cap at `min(routeLength, anchorSM + 600, nextUnpassedStopSM)`. A stationary bus stays stationary unless there is evidence of movement; never let a segment speed prior start a dwelling bus on its own.

Clamp that cap to at least `anchorSM` when a stop is slightly behind the anchor but has not met the pass-confirmation margin. A fresh fix at a stop remains LIVE/DWELLING; cap-based staleness applies only once the live timeout has elapsed. Follow the exact stale-deadline rule in the API contract on both client and server.

Do not mark a stop passed from predicted position. Require accepted evidence beyond its confirmation margin. At the cap freeze the estimate, preserve the last confirmed coordinate separately, and suppress tracking ETA when stale.

Compute projection and logical expiry at read/mutation time, without requiring a one-second server ticker. List queries filter expired journeys even if cleanup has not run. End cleanup can happen opportunistically; access expiry must already be enforced.

Recovery uses the elapsed-time expanded search. Plausible agreeing evidence may reset the filter; a suspicious large change needs two consecutive agreeing fixes or two distinct agreeing sources. Emit one structured correction event after commit. Do not permanently reject valid re-entry merely because it is far beyond the old 600m cap.

For an apparent diversion, require sustained agreement from at least two previously consistent sources before setting `offRoute`. A single malicious off-corridor source cannot establish diversion. Preserve the last route anchor, suppress ETA, and show uncertainty; do not put an off-route raw phone coordinate on the public map as verified bus position.

## ETA

Compute remaining along-route distance, blended recent/typical speed, and intermediate-stop dwell allowance. Clamp speed to a sensible positive floor. Use segment typical speed for ETA while dwelling, without moving the position marker.

Start with ±25% for live arrival ranges and ±40% for estimated ranges; label them approximate and measure performance. Round at display time. Zero distance at an estimated cap means “near stop, unconfirmed”, not “passed” or a guaranteed arrival.

Return null when pending, off-route, ended, or stale without an actual timetable. Delay is null when no verified timetable exists. AC24 departure times are not established by this instruction package.

Optional traffic refresh is cached outside the ingestion hot path. Verify returned paths match the fixed route before applying travel times. An AWS routing timeout must not make the basic ETA endpoint fail.

## DynamoDB model and recovery

Use one on-demand table with string `PK`, `SK`, and epoch-seconds `ttl` where applicable. Suggested keys:

| Record | PK | SK | Rule |
| --- | --- | --- | --- |
| Journey state | `JOURNEY#id` | `STATE` | Versioned authoritative snapshot; metadata, bounded contributor hashes, filter, sequences, event ring |
| Route membership | `ROUTE#routeId` | `ACTIVE#journeyId` | Created atomically with STATE; stale entries filtered against authoritative expiry |
| Raw report | `JOURNEY#id` | `UPD#serverTs#contributorId#seq#requestId` | Collision-safe even inside one millisecond; expires after 48h |
| Durable event | `JOURNEY#id` | `EVT#timestamp#eventId` | Idempotent event ID; bounded retention |
| Idempotency marker | `IDEMPOTENCY#scope#keyHash` | `RESULT` | Atomic with the corresponding create/join mutation; short expiry |

Store membership/capability hashes with the versioned state for simple atomic permission changes. Enforce the 24-source cap and bounded rings well below DynamoDB's item-size limit. Never embed the raw trajectory in STATE.

Use strongly consistent state reads and conditional `version` checks. Creation uses a transaction for state, route membership, and idempotency marker. Joining similarly couples its marker and state mutation. An end transition commits before best-effort deletion of route membership; queries filter ended entries regardless.

Raw logs may batch writes with retry/backoff for unprocessed items. Bound the queue and log dropped diagnostic counts. A failed raw-log write must not roll back already committed fusion state. A failed authoritative state write must not be acknowledged as accepted.

In cloud mode every request can reconstruct the engine from STATE. Warm-process caches must not bypass version checks. No correctness depends on rehydrating an in-memory registry on boot. Test two service instances updating the same journey and a process restart with still-valid contributors.

## Privacy and operations

Show a short consent statement before GPS collection. Stop collection immediately on opt-out. Keep raw reports out of public state and logs. Treat per-journey random IDs as pseudonymous data, not anonymous proof.

Exclude records from application access after their retention expires; DynamoDB TTL later handles physical deletion. Do not claim instant erasure. Keep real-phone traces out of public scorecard fixtures. Tokens are redacted from HTTP logs and never embedded into links.

Liveness is local and cheap. Readiness reports configuration/initialization failure without details. Configure CORS for known web origins, bounded timeouts, graceful shutdown, and structured request/error logs. No broad AWS permission policy or static AWS credentials in the code.
