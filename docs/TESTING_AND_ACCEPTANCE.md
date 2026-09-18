# Testing and release acceptance

Test the behaviours that could mislead a passenger or break deployment. Do not write superficial tests that only repeat implementation details. Use deterministic injected time for algorithm tests and real time for HTTP simulator runs.

## Automated checks

Use Vitest for pure and API tests, an HTTP integration helper or real ephemeral server for endpoints, and a small Playwright suite for complete browser journeys. These are selected implementation tools, not extra product features.

The required `npm run check` covers lint, types, route validation, meaningful tests, and production build. CI performs these from a clean checkout with `npm ci`; it does not need cloud secrets. Include E2E checks in CI after installing the matching browser runtime.

### Geometry and fusion

- Known point-to-segment projections, route interpolation round trips, zero-length segments, and metres/degrees correctness.
- AC24 checkpoints ordered and within tolerance of the committed line.
- Three good reports plus a high-weight on-route liar: liar excluded and good cluster retained.
- Two-source conflict, lone source, changing source cadence, noise, impossible jump, and good-source false rejection rate.
- Replaying the same source measurement does not shrink uncertainty repeatedly.
- Identical clocks shifted by ±2 hours on a phone do not move the bus or alter freshness.
- Recovery after legitimate movement beyond 600m succeeds when plausible and confirmed.
- Initial no-fix state stays `PENDING` with null coordinates/ETAs.
- Correct boundaries at 10s, 90s, cap arrival, and 300s; include sources dropping while `DWELLING`.
- Estimated position cannot mark a stop passed, even at exactly the stop coordinate.
- A dwelling bus does not move solely because a typical segment speed is nonzero.
- Fresh fixes at a stop remain LIVE/DWELLING; an unconfirmed stop-pass margin never pulls projection backward.
- Off-route ambiguity suppresses ETA and cannot be declared by one newly joined spoofer.
- ETA never contains NaN/Infinity and stays null where unavailable; route end stays bounded.

### API and durable state

- Create/join/report/read/end through actual routes and runtime validation.
- Driver privilege cannot be obtained by setting `role:'driver'` in a join body.
- A read-only ops capability cannot post locations or end a journey.
- Public endpoints never contain source IDs, raw source positions, code/token hashes, or capabilities.
- Unauthenticated debug returns an auth error, including for demo journeys.
- Duplicate and out-of-order reports are not assimilated twice; newest stale batch cannot become LIVE.
- Oversized body/batch, malformed inputs, unknown route, ended writes, and rate limits have the contract's statuses.
- Repeated/concurrent idempotency keys create at most one resource; a lost token response follows the documented conflict path.
- Two simultaneous DynamoDB updates preserve both valid transitions or return a documented retryable error; no last-writer overwrite.
- End-versus-ingest and revoke-versus-ingest races recheck permissions after a conditional-write conflict.
- Restart with DynamoDB retains committed state and valid contributor capabilities; memory mode explicitly resets.
- Authoritative-store failure does not report success. Asynchronous diagnostic-log failure does not erase committed tracking state.
- Expired raw data is excluded before physical TTL deletion; expired journeys disappear from active lists without a timer.

### Browser integration

Use a real local API for the core flows. Browser geolocation may be injected for deterministic tests, but mark it as emulation. Never replace the entire network with mocks in the only E2E suite.

- Open `/`; route data, stop list, and map initialise.
- Select a stop by map and list; both update the same arrival panel and shareable link.
- Start/join journey, post fixes, see one bus marker, and end cleanly.
- Denied location permission shows a useful recovery path without triggering repeated prompts.
- Stop-sharing stops the watcher, queued uploads, and late retry behaviour.
- Dropped polls locally degrade mode and stop at the cap/deadline; the dot never drifts forever.
- Missing tiles/WebGL leaves a usable text view and clear map error.
- Unauthenticated ops page exposes no diagnostics.
- Every deep link refreshes after a production-style static build.

For CI, use a deterministic local map style fixture if external tiles are unreliable, while still running MapLibre. Separately verify the actual Amazon street tiles in a browser before claiming production map integration.

## Simulator contract

Create `apps/simulator` as a CLI, not a hidden backend test endpoint. It uses the normal create/join/report/state/debug flow, manages its own capabilities, and marks journeys `isDemo:true`. Keep truth private to the simulator. Use seeded randomness and save seed/configuration with results.

The simulator owns true route progress, dwell, source-specific along/cross-track noise, sample timing, network failure, and dropouts. Backend must never receive ground-truth position in a special field.

HTTP scenarios run at `timeScale=1`; reject other values with a clear explanation. Accelerated tests run directly against the pure engine with an injected clock, under a separate command and label. A full real AC24 trip need not fit in seven minutes; short scenarios exercise a valid portion at plausible speeds. Video editing can compress a recording.

### Required scenario library

| Scenario | Verifiable outcome |
| --- | --- |
| `happy-single` | One source tracks with conservative uncertainty |
| `happy-multi` | Multiple ordinary sources produce one stable journey estimate |
| `driver-drops` | Remaining fresh sources keep journey LIVE |
| `all-drop-30s` | Estimated state, bounded motion, return to LIVE |
| `all-drop-180s` | Frozen stale state, no predicted stop-pass claim |
| `spoof-static` | Off-route spoof rejected |
| `spoof-onroute` | On-route high-accuracy outlier does not override majority |
| `jump-recovery` | Reject an impossible jump; accept plausible confirmed re-entry after a gap |
| `bad-accuracy` | Poor reports rejected without crashing or excluding good sources |
| `clock-skew` | Device clock offsets do not change state timing |
| `partition` | Reconnect backlog is historical; fresh report drives current state |
| `traffic-jam` | Slower movement extends ETA sensibly |
| `two-journey-isolation` | Backend keeps independent states on the same route |

Specify scenario configuration, expected mode windows, maximum errors, and expected rejection counts before running. Make malicious sources malicious from their first report; do not accidentally add an honest report during the intended total blackout. At the end revoke/end the simulator's own journey where possible. Do not end other people's journeys.

Output JSON/CSV plus a small truth-versus-estimate chart. Exit nonzero if expectations fail. Report position p50/p95, blackout maximum error, recovery seconds, spoof/false rejection rates, and empirical confidence coverage. Guard against an empty metric set: no LIVE samples must not produce a fake zero error.

Initial targets from the plan are hypotheses: live p95 under 40m, 30-second blackout error under 150m for its defined motion fixture, recovery under 6s, spoof rejection 100% in the stated spoof scenarios, and false rejection below 2%. Do not promise these for all real traffic. If measured results miss targets, document the scenario and fix/tune before claiming success; do not fabricate a scorecard.

## Manual mobile and desktop review

Record screenshots at 390×844, 768×1024, 1440×900, and check a 320px width for overflow. Check a short landscape viewport and 200% zoom. Review:

- First visit with no active journey.
- Active demo, live contribution, total GPS loss, stale estimate, and recovery.
- Stop selection, map pan/recenter, attribution, copy link, form validation, and keyboard focus.
- Primary touch areas, long stop labels, readable muted text, and reduced-motion setting.
- Android and iPhone Safari when devices are available; document which device/browser was actually used.

Phone screen lock can suspend capture. Confirm that guidance says sharing pauses and that fresh reporting resumes correctly when reopened. Do not expect the queue to contain positions never recorded while suspended.

## Completion checklist

### Working application

- [ ] BusKothay branding and AC24 Patuli → Howrah direction are consistent.
- [ ] Real map, sourced/labelled geometry, selected stops, and attribution work.
- [ ] Frontend uses the real API; simulator drives it through ordinary endpoints.
- [ ] Start, join, consent, share, pause/stop, and end work with correct privileges.
- [ ] Fusion, outage limits, stale labels, recovery, and null ETA rules work.
- [ ] Diagnostics is protected and meaningful.
- [ ] Mobile and desktop layouts match the design guide and are accessible.

### Repository and deployment package

- [ ] A clean clone can install, run, test, and build using README alone.
- [ ] Lockfile, environment examples, gitignore, CI, Dockerfile, and Amplify config exist.
- [ ] Production container starts and resolves shared modules and route data.
- [ ] DynamoDB integration, restart recovery, and concurrency checks pass.
- [ ] No credentials or private phone traces are committed.
- [ ] Manual-editing guide points to real implemented files.
- [ ] Team git workflow is documented; no remote or authorship was invented.

### Deployment verification, when cloud access is available

- [ ] Actual public HTTPS URLs are recorded and tested.
- [ ] Amazon map tiles, API CORS, direct route refresh, and ingestion work publicly.
- [ ] At least one deployed simulator run passed with saved measured results.
- [ ] Device testing results and any untested areas are stated accurately.

Report these three completion levels separately if deployment cannot proceed. A local success is valuable, but it is not a deployed website.
