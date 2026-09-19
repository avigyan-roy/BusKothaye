# About BusKothay

## Project summary

**BusKothay** is a mobile-first, community-assisted bus tracking web application for Kolkata. It is designed to answer the questions a passenger actually has while waiting:

- Where is the bus now?
- Which stop is next?
- How long might it take to reach my stop?
- Is that answer based on a recent location, an estimate, or no reliable data?

The product opens directly on a dark, map-first passenger view. It does not require an account merely to view a route or a public journey. People who deliberately take part as drivers, conductors, or passengers can share browser GPS updates after giving consent. The server combines accepted reports into one bounded public position and a set of stop ETAs without exposing each contributor's raw location.

This document describes the implementation in this repository. The practical setup and deployment commands are in [README.md](../README.md); the detailed product and engineering decisions remain in the [project documentation](../docs/WORKSPACE_CONTEXT.md).

## Why we are building it

Fixed route lists and timetables do not tell a waiting passenger where a bus is right now. A single phone's GPS can also be inaccurate, late, or unavailable. BusKothay approaches that gap as a small transport product rather than as a decorative map:

1. A journey is attached to a versioned route.
2. Participating devices submit ordinary HTTPS location reports.
3. The backend checks each report against accuracy, time, movement, and route-corridor rules.
4. Accepted evidence is fused into a public journey state.
5. The passenger interface refreshes that state and clearly distinguishes live, estimated, stale, pending, and ended information.

The goal is useful, honest information. The interface does not call an old or simulated position “live,” and an unavailable ETA stays unavailable instead of becoming a made-up number.

## Who the application serves

### Passengers

Anyone can open the route map, select a checkpoint, see active journeys, inspect the last-update age, and read the best available ETA. A signed-in passenger can mark that they boarded only when fresh, confirmed journey evidence says the bus is at the selected stop. After boarding, the interface shows the stops and ETAs ahead.

Boarding does **not** silently start GPS. Location contribution is a separate, explicit action. If the passenger chooses to share, their device reports travel through the same validation and fusion path as every other source. They can pause sharing or mark that they got off.

### Drivers and conductors

A driver can create a journey for a trackable route and then choose when to start browser location sharing. The journey produces separate capabilities for driving, joining, and protected diagnostics. Conductors and passengers can join with the journey ID and join code, but joining never grants driver control.

Pausing GPS is intentionally separate from ending a journey. This prevents a temporary permission or network problem from accidentally terminating the public trip.

### Administrators

Fleet simulation controls are restricted to a server-owned administrator account; an ordinary passenger, driver, or conductor account cannot see or use those controls. Local development provides the convenient `admin` / `admin` bootstrap credentials and a standard show-password checkbox. A production process refuses those development credentials and requires a separate administrator username and a unique password of at least 12 characters through server-only environment variables.

The administrator console can choose a route, a starting checkpoint, a destination checkpoint, bus and source counts, update cadence, normal city speed, stop dwell time, GPS noise, looping, pause, and an outage condition. Changes are audited and simulated journeys remain visibly labelled.

## What is implemented

- A responsive React passenger application with mobile and desktop layouts.
- A real MapLibre GL JS map with route geometry, checkpoints, attribution, journey markers, selection, and explicit map-loading/error states.
- Amazon Location Maps V2 support for the production-style dark basemap, plus a clearly disclosed credential-free development basemap.
- Public route and journey reads with one-second passenger polling.
- Account registration, login, logout, role selection, password changes, and server-owned administrator access.
- Driver journey creation, role-matched joining, voluntary browser geolocation, pausing, leaving, and ending.
- Stop-gated passenger boarding, future-stop ETAs, and optional passenger contribution after boarding.
- A pure fusion engine with injected time, route projection, consensus checks, bounded extrapolation, source reputation, and explicit lifecycle states.
- In-memory storage for quick local work and a DynamoDB repository for durable deployments.
- A separately supervised fleet worker that uses the normal HTTP API rather than writing private application state directly.
- Runtime validation and shared TypeScript contracts across the web app, API, and worker.
- Route validation, unit/API tests, browser tests, production builds, and container definitions.

## System architecture

```text
Passenger / contributor browser
  React + Vite + MapLibre GL JS
  Amazon Location Maps V2 basemap
                 |
                 | HTTPS + JSON
                 v
          Node.js + Express API
          Zod runtime validation
                 |
          Journey service layer
                 |
      Pure projection + fusion engine
                 |
        memory (local) or DynamoDB

Supervised fleet worker ---------> same HTTP API
```

The browser never talks directly to DynamoDB. The API is the authority for route availability, journey membership, accepted locations, fused state, and authorization. Static route data is versioned and may be cached briefly; account responses, live journey state, diagnostics, and capabilities use `Cache-Control: no-store`.

## Technology stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Language | TypeScript | Shared types and safer changes across every application workspace |
| Web application | React 18, React Router, Vite | Passenger, contributor, account, admin, and diagnostics experiences |
| Map rendering | MapLibre GL JS | Interactive vector map, route line, stops, and moving journey marker |
| Basemap | Amazon Location Maps V2 | Dark street map in the configured AWS region |
| API | Node.js 24 LTS, Express 5 | HTTP routing, authorization, journey operations, and public state |
| Validation | Zod | Runtime request, response, environment, and route-data validation |
| Geometry | Repository TypeScript package | Polyline distance, projection, interpolation, and route preparation |
| Durable data | Amazon DynamoDB | Accounts, sessions, journeys, idempotency records, and control state |
| Local durable data | DynamoDB Local | Restart and persistence testing without using an AWS account |
| Containers | Docker | Reproducible API and worker images using Node.js 24 |
| Web hosting | AWS Amplify Hosting | Builds and serves the static React application |
| API and worker hosting | AWS Lightsail Containers | Public API container plus a private worker container in one service |
| Tests | Vitest and Playwright | Geometry/shared/API behavior and responsive browser journeys |

The repository is an npm workspace containing separate geometry, shared-contract, API, web, and simulator packages. Shared DTOs are compiled once and imported by each consumer, which avoids maintaining incompatible copies of an API type.

## How location reports become a public bus position

### 1. Consent and capability

A contributor first signs in and creates or joins a journey. The server issues a narrow bearer capability. Tokens are returned to the appropriate client, while the server persists hashes rather than raw capability values. Browser geolocation starts only after a visible user action.

### 2. Report validation

Each report includes a monotonically increasing sequence number, coordinates, accuracy, device time, sample age, and optional speed and heading. The API applies limits for payload size and rate, then rejects reports that are duplicated, out of order, too old, too inaccurate, implausibly fast, backward, outside the route corridor, or inconsistent with the current consensus.

### 3. Route projection and fusion

Accepted coordinates are projected onto the versioned route polyline. The fusion engine combines eligible sources, tracks uncertainty, and updates the confirmed progress and speed. The engine is pure and receives its clock from the caller, so the same transition can be tested or safely recomputed after a conditional-write conflict.

### 4. Bounded estimation

When fresh evidence briefly stops, the public marker may move from **LIVE** or **DWELLING** to **ESTIMATED**. Projection is bounded by time, the next checkpoint, and the route end. It then becomes **STALE** rather than continuing to animate indefinitely. Long inactivity can end the journey automatically.

### 5. Public response

The public state contains the fused position, confidence, speed, freshness, progress, source counts, stop statuses, ETA ranges, and a small sanitized event list. It does not reveal contributor IDs, individual coordinates, join codes, capability hashes, or protected diagnostic details.

## ETA behavior

ETAs are derived from route progress, current or recent credible speed, segment defaults, uncertainty, and configured dwell allowances. Each checkpoint communicates both status and evidence:

- **Live** — supported by recent accepted location evidence.
- **Estimated** — a short, bounded projection from the last confirmed evidence.
- **Schedule** — reserved for a verified schedule source; AC24 currently has no committed timetable.
- **Unavailable** — used when the application lacks enough evidence to estimate responsibly.

The UI can display a range instead of false precision. At a predicted stop arrival, the stop remains “near” until accepted evidence confirms that it has been passed.

## Route data and map accuracy

The catalogue currently records 28 WBTC service identities and gives each one a distinct display colour. A catalogue entry is not automatically a trackable route: geometry and boarding points must be checked before the API makes that service available for journeys.

At present, **AC24 Patuli → Howrah** is the only trackable route. WBTC's published material supports the route identity and the ordered corridor through Ruby, Gariahat, Hazra, Exide, Park Street, and Esplanade. It does not provide a downloadable official route shape or exact boarding coordinates.

The current AC24 line is an **OpenStreetMap-routed approximation** through eight approximate checkpoints. It follows roads and is a better visual fit than hand-drawn straight segments, but it is not proof of the exact bus carriageway, stop bay, one-way movement, or reverse route. The route file keeps both approximation flags enabled and includes its source, licence, date, and limitations. A reviewed GPS/GPX field trace or reliable operator-supplied route is still required before calling the geometry verified.

The other 27 WBTC services remain catalogue-only. The application does not invent lines or boarding positions for them. They should be enabled one at a time after trustworthy route evidence is reviewed.

## Main HTTP API areas

All application endpoints use JSON under `/v1` except the liveness and readiness checks.

| Area | Representative operations |
| --- | --- |
| Health | `GET /health`, `GET /ready` |
| Routes | List route summaries, load a versioned route, list its active journeys |
| Accounts | Register, sign in, read the current account, change role/password, sign out |
| Journeys | Create, join, board at a confirmed stop, submit locations, leave, end |
| Passenger state | Read fused state and stop ETAs without a contributor capability |
| Diagnostics | Read bounded debug information with a driver or operations capability |
| Administration | Read/update/reset the supervised fleet control with an administrator session |
| Worker control | Poll control state and acquire a generation-fenced lease with the private worker identity |

Create, join, and board operations support idempotency so a client retry does not silently create duplicate journeys or contributors. DynamoDB mode uses versioned conditional writes to protect state from concurrent updates.

## Security and privacy choices

- Public pages expose fused journey information, not the path of an individual person.
- Raw passwords are never stored; password verification uses a password KDF.
- Session, contributor, driver, operations, join, and worker secrets have different purposes.
- Raw capability values and private AWS credentials are not placed in URLs, public responses, or routine logs.
- Administrator status is server-owned. Registration and role-change requests cannot grant it.
- Production configuration rejects memory persistence, localhost CORS origins, incomplete admin credentials, and the local `admin` / `admin` password.
- The Amazon Location browser key is separate from AWS runtime credentials and should be restricted by action, referrer, expiry, and quota.
- Location sharing is opt-in, visibly stoppable, and independent from simply viewing the map or marking that a passenger boarded.
- Protected diagnostics are bounded and use journey-local source labels rather than public personal identifiers.

This is an engineering privacy baseline, not a substitute for a production privacy policy, retention review, abuse review, and applicable legal assessment before a public launch.

## Development and validation without field access

Because a full bus-and-passenger field test is not currently available, the repository includes a clearly labelled location simulation. It sends driver and passenger-style updates through the same public journey and location APIs, so it is useful for exercising map movement, ETAs, boarding, outages, stale states, and multiple-source fusion. It does **not** prove GPS quality, mobile-background behavior, mobile-network reliability, stop accuracy, public scale, or real-world ETA performance. Those claims require physical-device and in-service testing.

## Local runtime choices

The complete application can be run locally in several useful configurations:

1. **Fast development:** Vite web app + Express API + memory storage + the disclosed MapLibre development basemap.
2. **Real map locally:** the same application with a restricted Amazon Location Maps V2 browser key.
3. **Persistence testing:** the API and DynamoDB Local through Docker Compose.
4. **Supervised movement testing:** the separate fleet worker against the normal local API.

The authoritative commands and environment examples are in [README.md](../README.md). Node.js 24 LTS and npm 10.9 or newer are required.

## AWS deployment design and current status

The current deployment runbook uses the following arrangement in `ap-south-1`:

```text
AWS Amplify Hosting
  static React/Vite website
           |
           | HTTPS
           v
AWS Lightsail Container Service (micro, scale 1)
  - API container: public port 8080
  - fleet worker: private, calls the API on localhost
           |
           v
Amazon DynamoDB on-demand table

Browser ------------------> Amazon Location Maps V2
```

The DynamoDB template enables on-demand billing, server-side encryption, point-in-time recovery, TTL, and retention protection. Lightsail runs the API and worker together so the worker can use the private localhost API address; scale remains one to avoid duplicate active workers. Amplify builds the web workspace from the monorepo root and the guarded production build refuses localhost API settings, a non-Amazon map provider, or a missing map key.

The repository contains the code, containers, infrastructure inputs, and step-by-step AWS runbook, but **no cloud deployment or public URL is claimed by this document**. This workspace has not supplied evidence of a completed production deployment or production smoke test. An authorized AWS operator must still provision the resources, add private values outside Git, verify the selected account and region, restrict CORS and the map key to the final Amplify origin, and run the full browser and physical-device checks.

The repository also retains older App Runner-oriented infrastructure files for historical context. The current README deployment path is Lightsail Containers plus Amplify; those older files should not be mixed into that runbook.

## Testing and verification

The repository provides checks for different failure classes:

| Command | What it checks |
| --- | --- |
| `npm run lint` | Source lint rules |
| `npm run typecheck` | TypeScript contracts across every workspace |
| `npm run routes:validate` | Route schema, geometry, stop order, distance, and provenance invariants |
| `npm test` | Geometry, shared logic, and memory-backed API behavior |
| `npm run build` | Compiled packages, API, worker, and local-preview web bundle |
| `npm run build:deploy` | Guarded production web configuration and bundle |
| `npm run test:e2e` | Responsive browser flows against a local API |
| Docker builds | Container dependency and runtime packaging |

Passing local checks does not by itself verify DynamoDB on AWS, Amazon Location key policy, Lightsail networking, Amplify rewrites, browser GPS on a real phone, or route correctness in traffic. Release notes should record exactly which environment, URL, date, device, and checks were actually verified.

## Repository guide

| Location | Responsibility |
| --- | --- |
| `apps/web/` | React UI, map, account, contribution, boarding, admin, and diagnostics pages |
| `apps/api/` | Express routes, services, fusion, authentication, and persistence adapters |
| `apps/simulator/` | Supervised fleet worker and measured scenario runner |
| `packages/shared/` | Zod schemas, DTOs, constants, and shared projection rules |
| `packages/geometry/` | Route and polyline geometry utilities |
| `data/routes/` | Versioned route catalogue and trackable route fixtures |
| `infra/` | DynamoDB and Lightsail deployment inputs, plus retained historical infrastructure |
| `docs/` | API, route, backend, frontend, design, deployment, testing, and editing guidance |
| `scripts/` | Development orchestration, route validation, screenshots, and data utilities |

Before changing a route, API shape, threshold, colour, or deployment value, consult [MANUAL_EDITING.md](../docs/MANUAL_EDITING.md) so that the authoritative source is changed instead of duplicating configuration.

## Known limitations and next validation work

- AC24 still needs an operator-backed route shape or reviewed GPS/GPX field trace.
- The selected checkpoint coordinates and exact boarding sides need on-site review.
- The remaining catalogue routes need verified geometry and boarding data before tracking is enabled.
- There is no verified AC24 timetable in the repository, so schedule-based arrival claims remain disabled.
- Browser GPS, permission recovery, screen-off behavior, and location reporting need physical Android and iOS testing over mobile data.
- ETA quality needs measurement against real arrivals under Kolkata traffic conditions.
- AWS deployment, restart recovery, CORS, restricted map-key behavior, logs, costs, and teardown need verification in the authorized target account.
- A public release needs accessibility, privacy, abuse, operational ownership, and data-retention reviews in addition to the automated checks.

## Definition of a trustworthy release

BusKothay should be called ready for public use only when the application build passes, the AWS services are independently verified, the route has reliable geometry, and an in-service physical test confirms that contributors can share, passengers receive honest state transitions, boarding works at the intended stop, and ETAs are measured against reality. Until then, the repository is a working implementation and validation platform—not evidence of real-world service performance.
