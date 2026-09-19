# Editing BusKothay by hand

Paths below are relative to the application repository root. Read [implementation context](IMPLEMENTATION_CONTEXT.md) for setup prerequisites and unresolved gaps.

Every path below exists. Nothing here needs a prompt, a regeneration step, or an
AI to change — open the file in an ordinary editor and edit it.

## Where to change things

| What you want to change | File | What to check afterwards |
| --- | --- | --- |
| Product name, tagline, default route | `apps/web/src/config/site.ts` | Header wordmark, browser title (set in `main.tsx` from `site.name`), `apps/web/public/manifest.webmanifest`, README |
| Any visible text, empty states, consent copy | `apps/web/src/content/en.ts` | Long strings still fit at 320 px; no new claim the code cannot keep |
| Colours, radii, spacing, type scale | `apps/web/src/styles/tokens.css` | Contrast, focus rings, the map layer colours in `MapView.tsx`, screenshots at all five widths |
| Base page styles, fonts | `apps/web/src/styles/global.css` | Browser zoom to 200%, layout overflow |
| Passenger layout | `apps/web/src/pages/RoutePage.tsx`, `route-page.css` | Map, controls and sheet at 320 / 390 / 1440 px |
| Journey sheet and desktop drawer | `apps/web/src/features/journeys/JourneySheet.tsx`, `journey-sheet.css` | Collapsed height, expand/collapse, internal scrolling, Escape |
| Floating map controls and their icons | `apps/web/src/components/MapControlButton.tsx` | 44px targets, focus ring, active state on follow |
| Navigation menu | `apps/web/src/components/NavMenu.tsx`, `nav-menu.css` | Escape closes, focus returns to the menu button |
| Map behaviour, layers, markers | `apps/web/src/features/map/MapView.tsx`, `map-view.css` | Stop selection, recentre, attribution never cropped, resize |
| Basemap provider and the offline fixture | `apps/web/src/features/map/mapStyle.ts`, `localStyle.ts` | Disclosure text still matches what is actually being drawn |
| Arrival panel and stop list | `apps/web/src/features/journeys/` | Null ETA states, passed stops, long stop names |
| Passenger boarding and onboard ETAs | `apps/web/src/features/journeys/BoardingPanel.tsx`, `apps/web/src/pages/RoutePage.tsx`, `apps/api/src/service/journey-service.ts` | Passenger-only access, confirmed-stop gate, future ETAs, explicit GPS consent, leave cleanup |
| Start / join / share flow | `apps/web/src/features/contribution/useGeoSharing.ts`, `apps/web/src/pages/DrivePage.tsx` | Consent, refused permission, stop-sharing cleanup, queue count |
| Administrator bootstrap and sign-in | `apps/api/src/config.ts`, `apps/api/src/service/account-service.ts`, `apps/web/src/pages/AdminLoginPage.tsx` | Local `admin` / `admin`, production rejection of that pair, server-owned `isAdmin`, show-password behavior |
| Admin-only fleet dispatch | `packages/shared/src/schemas/demo.ts`, `apps/api/src/service/demo-service.ts`, `apps/web/src/pages/DemoConsolePage.tsx`, `apps/simulator/src/fleet-worker.ts` | Non-admin 403/redirect, valid start/end order, 5–50 km/h, generation fencing, worker lease |
| Diagnostics screen | `apps/web/src/pages/OpsPage.tsx`, `ops-page.css` | Still refuses to fetch anything without a capability |
| Route catalogue, availability and colours | `data/routes/catalog.json`, `packages/shared/src/schemas/route.ts` | Unique uppercase hex colours, unavailable routes have no invented geometry, directory still works |
| AC24 stops and geometry | `data/routes/ac24-patuli-howrah.json` | `npm run routes:validate`, bump `version`, re-run the simulator |
| Thresholds, timings, trust weights | `packages/shared/src/constants.ts` | `npm test`, then the simulator scenarios that assert on them |
| Wire format and validation | `packages/shared/src/schemas/` | API, web and simulator update together, in one change |
| The bounded projection | `packages/shared/src/projection.ts` | Both server and browser use this; never fork it |
| Gates, consensus, filter, transitions | `apps/api/src/fusion/` | `apps/api/test/fusion.test.ts` and a full scenario run |
| Arrival calculation | `apps/api/src/fusion/eta.ts` | ETA tests; check nothing can return NaN or Infinity |
| Persistence and retention | `apps/api/src/store/` | Restart, concurrent writers, expiry, and the privacy copy in `en.ts` |
| Server settings | `apps/api/src/config.ts` and `apps/api/.env.example` | Keep the example in step; admin and worker secrets stay uncommitted |
| Public API URL or map key | `apps/web/.env.local` locally, Amplify build environment in the cloud | Rebuild the web app; test the URL, the map requests and CORS |
| Container, compose, hosting, infra | `Dockerfile`, `compose.yaml`, `amplify.yml`, `infra/` | Build the image and run the release checks in `infra/RUNBOOK.md` |
| Measured simulation scenarios | `apps/simulator/scenarios/*.json` | Seeded expectations, plausible speeds, real-time clock |

## The routine loop

1. Branch, and run the app locally (`npm run dev`).
2. Change the smallest relevant file. Vite reloads ordinary UI edits on its own. Restart `npm run dev` after shared/geometry edits: shared packages are built once, not watched.
3. Look at the affected screen at a narrow mobile width and at a desktop width.
4. Run the checks that match what you touched. Text and spacing need
   `npm run lint` and a look; maths, authorisation and persistence need
   `npm test` too.
5. Review the diff, commit the files you meant to change, and push the branch.

## Worked examples

**Change the interface accent colour.** Edit `--color-accent`,
`--color-accent-hover`, `--color-accent-soft` and `--color-on-accent` together in
`tokens.css`, then review the selected-stop and status paint literals in
`MapView.tsx`. The route line itself uses the selected route's data-owned
`color`, not the global accent. MapLibre paint values cannot read CSS variables,
so the remaining literals are deliberate. Do not search and replace every hex.
Check primary buttons, selected rows, focus rings, and the dark basemap; status
must still read correctly in words because colour never carries meaning alone.

**Change one route's colour.** Edit the uppercase six-digit `color` in
`data/routes/catalog.json`. For a trackable route, make the same edit in its
versioned route JSON (currently `data/routes/ac24-patuli-howrah.json`). Run
`npm run routes:validate`, open the route directory, and inspect the line and
checkpoint contrast on the dark map. Colours identify routes; they must not
replace text labels or status badges.

**Rename a stop.** Change its `name` in the route JSON and leave its `id` alone;
the ID is what shareable `?stop=` links and stored preferences use. If the
coordinates move as well, the distances are re-derived automatically — run
`npm run routes:validate` and bump `version`.

**Change how long an estimate may run.** Edit `ESTIMATE_HORIZON_S` in
`constants.ts`. That single constant moves the server's stale deadline, the
browser's freeze point and the simulator's expectations together. Then update the
`all-drop-*` scenario windows and re-run them. Never add a second timeout in the
frontend.

**Add a reverse journey.** Create a separate direction file with its own verified
geometry. Do not reverse the coordinates: Kolkata's road directions and boarding
points differ, and a reversed line will put the bus on the wrong carriageway.
Outside the first release unless someone asks for it.

**Change the deployed API URL.** Update `VITE_API_BASE_URL` in the Amplify build
environment and rebuild — Vite embeds it at build time, so editing a local `.env`
changes nothing about a site that is already deployed. Then update `CORS_ORIGINS`
on the API if the web origin changed.

**Change the administrator credentials.** For a new local memory store, set
`ADMIN_USERNAME` and `ADMIN_PASSWORD` together in `apps/api/.env`; omitting both
uses the development-only `admin` / `admin` account. A production process
requires both variables, requires at least 12 password characters, and rejects
that development pair. The bootstrap creates a missing administrator but never
promotes a colliding ordinary account and never overwrites an existing persisted
administrator's password. Rotate an existing password through the signed-in
account password form, then verify `/demo` still returns 403 to an ordinary
passenger, driver, and conductor.

**Change fleet dispatch limits.** Edit `DemoFleetConfigSchema` in
`packages/shared/src/schemas/demo.ts`, the matching control in
`DemoConsolePage.tsx`, and worker behavior together. The service must continue to
reject untrackable routes, unknown checkpoints, and a destination at or before
the start. Keep city movement within an honestly labelled, plausible band; the
current UI and schema allow 5–50 km/h. Run the API tests and
`apps/web/e2e/admin-demo.spec.ts`.

**Change when boarding is allowed.** The public `boardableStopId` is derived in
`apps/api/src/fusion/engine.ts` from fresh confirmed evidence and
`STOP_NEAR_M`; it is not a frontend-only distance check. Keep the API's
passenger-role check and selected-stop equality check in
`JourneyService.boardJourney`. Then test arrival, wrong stop, bus moved away,
anonymous/driver refusal, restored passenger capability, optional GPS consent,
and **I got off** cleanup.

**Replace the approximate route geometry.** The current registry retains only one geometry per route ID; storing `routeVersion` does not preserve an old fixture. Resolve the version-handling gap in [implementation context](IMPLEMENTATION_CONTEXT.md) before replacing geometry used by retained journeys. Run
`node scripts/fetch-route-geometry.mjs` with a routing provider, inspect the line
on a street map, bump `version`, run `npm run routes:validate`, and only then set
`isApproximateGeometry` to false by hand.

## Style

Names carry their units: `lastConfirmedAtMs`, `remainingDistanceM`,
`speedMps`, `computeStopEta`. Comments explain why a number or a rule exists, not
what the line does. Files stay small enough that map, authorisation, HTTP and
geometry never share one.

Do not commit build output to make the site look deployable. Commit source and
build configuration.

## Before asking an AI to help

Point it at `AGENTS.md` and name the exact change. Tell it which of your manual
edits matter, and require it to read the current code rather than trusting its
own previous output. Ask for focused edits and real verification. If it proposes
replacing the stack or redesigning the app, make it give a concrete reason tied
to what you asked for.
