# Build progress — resume here

This file is the handover note between working sessions. It records what exists,
what was actually verified, and what to pick up next. Keep it accurate: an
optimistic progress file is worse than none.

**Last updated:** 2026-09-18
**Status:** continuation in progress; Phases 1–4 reconstructed, Phase 6 partly repaired, Phase 5/7/final verification still open. Not deployed.

**Documentation review, 2026-09-18:** results below are historical, not rerun. See [implementation context](docs/IMPLEMENTATION_CONTEXT.md) for missing CI, DynamoDB test coverage, route-version handling, and corrected setup commands.

## Continuation update — 2026-09-18

The incoming chat summary said Phases 1–5 were committed and green, but those
files/commits were not present in this checkout. The missing work is being rebuilt
here. Current source includes the Amazon V2 map behavior, accounts and server-side
authorization, 20-route catalogue, demo control plane/web console, persistent
fleet worker, and several Phase 6 queue/DynamoDB/polling/state-size fixes. See
[docs/IMPLEMENTATION_CONTEXT.md](docs/IMPLEMENTATION_CONTEXT.md) for the exact
handoff and remaining work.

A full post-change TypeScript/Vite build passes under Node 24 for all workspaces.
Post-change lint, tests, Playwright, Docker/DynamoDB Local, simulator runtime,
visual inspection, and AWS remain unverified. Earlier test counts below are
historical and must not be presented as current.

## What this repository is

The working application described by the instruction package in the parent
folder (`AGENTS.md`, `INSTRUCTIONS.md`, `docs/`). Those specification files are
copied in here too, so this directory is a self-contained repository the team can
clone. The parent folder now links to the application and explains documentation ownership; it is not the npm root.

## Decisions taken during the build

| Decision | Reason |
|---|---|
| Application lives in `buskothay/`, not the instruction folder root | Asked and confirmed by the user |
| Local-verified only; no AWS deployment attempted | Asked and confirmed by the user. The deployment package is written and reviewed but explicitly **not applied** |
| Route geometry is a hand-authored corridor approximation | The build environment had no network route to any routing provider (nodejs.org and OSRM were both refused by the egress proxy). Labelled `isApproximateGeometry: true`; the UI discloses it. `scripts/fetch-route-geometry.mjs` regenerates it properly when a provider is available |
| Segments authored between checkpoint IDs, not distances | A coordinate edit then cannot leave the speed table pointing at the wrong stretch of road. Distances are derived in `prepareRoute` |
| `apps/api/src/service/` added to the specified layout | Business rules live outside route handlers, as `BACKEND_INSTRUCTIONS.md` requires; the specified tree had no folder for them |
| Rate limits overridable by environment variable | A browser-test run legitimately creates a dozen journeys a minute. Production defaults are unchanged and the API tests still cover them |
| Basemap-free local map style added | The browser tests run MapLibre without depending on an external tile server, and it is the fallback when the configured basemap cannot be reached — a blank map is an error state, not a finished feature |
| Node 24.21.0 used for the build | Matches the `.nvmrc` baseline from `docs/DECISIONS.md` §1 |
| The API dev script runs compiled output with a `tsc --watch` beside it | Node's type stripping does not rewrite import specifiers, and this project's ESM imports end in `.js`. Running the `.ts` source directly failed on the first import. Found by running `npm run dev`, after it had been documented but not run |
| `ROUTE_DATA_DIR` resolves against the working directory, then walks up to the repository root | The API starts from the repo root, from `apps/api`, and from `/app` in the container. A bare relative resolve killed it on boot in one of those |
| `--env-file-if-exists=.env` on the API | Copying `apps/api/.env.example` previously did nothing at all: no environment file was ever read |
| `build` and `build:deploy` split for the web app | The deploy guard is right, but it was wired into the ordinary `build`, so `npm run check` could never pass on a machine without cloud settings. `build` is now an unguarded production build; `build:deploy` is the guarded one, and amplify.yml and CI use it. Found by running `npm run check`, after it had been documented but not run |

## Progress

- [x] **Workspace** — npm workspaces, `tsconfig.base.json`, `.nvmrc` (24), ignore
      files, ESLint, five packages.
- [x] **`packages/geometry`** — metric conversions, point-to-segment projection,
      prepared polyline, windowed projection, interpolation, slicing.
- [x] **`packages/shared`** — the whole API contract as Zod schemas, every tunable
      in `constants.ts`, the one bounded projection used by server and browser,
      route preparation and validation, clock abstraction.
- [x] **AC24 route fixture** — 65 points, 17.39 km, eight checkpoints, authored
      segment speeds, honest provenance, validator script.
- [x] **API fusion engine** — Kalman filter on `[sM, vMps]`, consensus before
      weighting with a 45% share cap, all rejection gates, elapsed-time recovery
      search, three-branch reconciliation, dwell detection, diversion rules,
      deterministic ETA with ranges. Pure, injected clock.
- [x] **API store, auth, HTTP** — memory and DynamoDB adapters behind one
      repository interface with versioned conditional writes; capabilities,
      hashed join codes, token buckets; every `/v1` endpoint, the documented error
      contract, CORS, request IDs, redacted logs, health and ready.
- [x] **Passenger web app** — real MapLibre map, route line, stops, bus marker,
      uncertainty area in real metres, stop selection synced to list, map and
      `?stop=` link, ~1 s polling with abort and backoff, shared bounded
      projection between polls, honest freshness states, all empty and error
      states, mobile-first layouts.
- [x] **`/drive` and `/ops`** — start/join, join code and copy link, explicit GPS
      consent, `watchPosition` with monotonic sample age, 3 s batched flush with
      queue cap, rejection feedback, pause vs stop vs end, wake lock,
      session-storage capabilities; protected diagnostics with sources,
      decisions, events and storage health.
- [x] **Simulator** — CLI driving the public API at `timeScale=1`, seeded
      randomness, private ground truth, all 13 required scenarios, JSON/CSV/SVG
      output, scorecard, non-zero exit when a declared expectation is missed.
- [x] **Tests** — 91 unit and API tests, 40 browser tests across mobile and
      desktop.
- [x] **Deployment package** — Dockerfile, `compose.yaml` (memory and DynamoDB
      Local profiles), `amplify.yml`, CloudFormation for the table,
      IAM, ECR, App Runner and log retention, plus `infra/RUNBOOK.md`.
- [x] **Documentation** — README, `docs/MANUAL_EDITING.md` and `CONTRIBUTING.md`
      rewritten against the files that actually exist.
- [ ] **Active CI workflow** — the workflow export is outside this repository; its E2E job also needs an API/shared build before testing.
- [ ] **DynamoDB integration tests** — current API tests use memory storage.
- [ ] **Full simulator scenario run** — stopped part-way at the user's request.
      See below.
- [ ] **Docker image build** — no daemon in the build environment.
- [ ] **AWS deployment** — out of scope for this stretch by the user's decision.

## Verified

Historical build-session report: Node 24.21.0, Linux container, against a real local API. Not rerun during this documentation review.

| Check | Result |
|---|---|
| `npm ci` from the committed lockfile | passes |
| `npm run dev` | starts both servers; the script now checks the API is responding and says so |
| `npm run lint` | passes, no warnings |
| `npm run typecheck` | passes |
| `npm run routes:validate` | passes; AC24 measures 17.39 km, checkpoints ordered |
| `npm test` (91 tests) | passes |
| `npm run test:e2e` (40 tests, mobile + desktop) | passes |
| `npm run build` | passes |
| Screenshots at 390 / 768 / 1440 / 320 px | captured; no horizontal overflow at any width |
| Production dependency layout (`npm ci --omit=dev` + compiled output + route data only) | starts and serves `/health` and the route — the container's runtime layout resolves `@buskothay/shared` |

### Simulator scenarios actually run

Four of thirteen. Each was a real-time run against a live API, and each met its
declared expectations.

| Scenario | Result | Measured |
|---|---|---|
| `happy-multi` | PASS | live error p50 9 m / p95 16 m; 0% false rejection; confidence covered 53% of live samples |
| `all-drop-30s` | PASS | p50 5 m / p95 16 m; blackout max error 6 m; recovery 1.1 s; coverage 98% |
| `all-drop-180s` | PASS | froze at Ruby and reported STALE; no stop claimed passed during the blackout |
| `bad-accuracy` | PASS | 100% of the 150 m-accuracy reports refused; 0% false rejection on good sources |

**Not run:** `happy-single`, `driver-drops`, `spoof-static`, `spoof-onroute`,
`jump-recovery`, `clock-skew`, `partition`, `traffic-jam`,
`two-journey-isolation`. The run was stopped part-way at the user's request
because the library takes about fifteen minutes of real time. The behaviours
those scenarios cover are exercised by the unit tests (see
`apps/api/test/fusion.test.ts` — consensus outliers, impossible movement,
backward motion, clock skew, batch history, recovery, source isolation), but the
end-to-end HTTP measurements for them have not been taken.

To finish it:

```bash
npm run dev                                   # or just the API
npm run simulate -- --scenario all --api http://localhost:3001
```

Results land in `apps/simulator/out/` as JSON, CSV and a truth-versus-estimate
chart per scenario. The command exits non-zero if any declared expectation is
missed.

One measurement worth keeping an eye on: in `happy-multi` the real error fell
inside the published confidence only 53% of the time, where a well-calibrated
one-sigma figure would be nearer 68%. That is mild overconfidence in the filter's
measurement variance. It is recorded rather than tuned away, because tuning a
number until the scorecard looks good is how a scorecard stops meaning anything.

## Not verified, and not claimed

1. **No deployment exists.** No AWS resources were created. `infra/` and the
   runbook are written and reviewed, not applied.
2. **The Docker image has not been built** — no Docker daemon in the build
   environment. The production dependency layout was checked separately (above),
   but `docker build` has not been run.
3. **No physical device testing.** Browser geolocation was emulated, and the
   tests say so.
4. **Route geometry is approximate** and has not been inspected on a street map.
5. **The production basemap has not been seen.** Development uses the MapLibre
   demonstration style; the browser tests use a basemap-free fixture. Amazon
   Location tiles need a real key and a look in the network panel.

## Next, in order

1. `docker build -t buskothay-api:local .` and run the container against
   `compose.yaml`'s DynamoDB Local profile — restart recovery and concurrent
   writers are the two things only that setup exercises.
2. Finish the simulator scenario library and retain reviewed synthetic scorecards as release artifacts; `apps/simulator/out/` is ignored by Git.
3. Resolve route-version lookup before replacing geometry used by retained journeys; then obtain and inspect a real road trace.
4. When the team has an AWS account: follow `infra/RUNBOOK.md`, in order, and
   record the actual URLs and test results in the README.
