# Editing BusKothay by hand

Every path below exists. Nothing here needs a prompt, a regeneration step, or an
AI to change — open the file in an ordinary editor and edit it.

## Where to change things

| What you want to change | File | What to check afterwards |
| --- | --- | --- |
| Product name, tagline, default route | `apps/web/src/config/site.ts` | Header wordmark, browser title (set in `main.tsx` from `site.name`), `apps/web/public/manifest.webmanifest`, README |
| Any visible text, empty states, consent copy | `apps/web/src/content/en.ts` | Long strings still fit at 320 px; no new claim the code cannot keep |
| Colours, radii, spacing, type scale | `apps/web/src/styles/tokens.css` | Contrast, focus rings, the map route colour in `MapView.tsx`, screenshots at all four widths |
| Base page styles, fonts | `apps/web/src/styles/global.css` | Browser zoom to 200%, layout overflow |
| Passenger layout | `apps/web/src/pages/RoutePage.tsx`, `route-page.css` | Map and panel at 390 / 768 / 1440 px |
| Map behaviour, layers, markers | `apps/web/src/features/map/MapView.tsx`, `map-view.css` | Stop selection, recentre, attribution never cropped, resize |
| Basemap provider and the offline fixture | `apps/web/src/features/map/mapStyle.ts`, `localStyle.ts` | Disclosure text still matches what is actually being drawn |
| Arrival panel and stop list | `apps/web/src/features/journeys/` | Null ETA states, passed stops, long stop names |
| Start / join / share flow | `apps/web/src/features/contribution/useGeoSharing.ts`, `apps/web/src/pages/DrivePage.tsx` | Consent, refused permission, stop-sharing cleanup, queue count |
| Diagnostics screen | `apps/web/src/pages/OpsPage.tsx`, `ops-page.css` | Still refuses to fetch anything without a capability |
| AC24 stops and geometry | `data/routes/ac24-patuli-howrah.json` | `npm run routes:validate`, bump `version`, re-run the simulator |
| Thresholds, timings, trust weights | `packages/shared/src/constants.ts` | `npm test`, then the simulator scenarios that assert on them |
| Wire format and validation | `packages/shared/src/schemas/` | API, web and simulator update together, in one change |
| The bounded projection | `packages/shared/src/projection.ts` | Both server and browser use this; never fork it |
| Gates, consensus, filter, transitions | `apps/api/src/fusion/` | `apps/api/test/fusion.test.ts` and a full scenario run |
| Arrival calculation | `apps/api/src/fusion/eta.ts` | ETA tests; check nothing can return NaN or Infinity |
| Persistence and retention | `apps/api/src/store/` | Restart, concurrent writers, expiry, and the privacy copy in `en.ts` |
| Server settings | `apps/api/src/config.ts` and `apps/api/.env.example` | Keep the example in step; secrets stay uncommitted |
| Public API URL or map key | `apps/web/.env.local` locally, Amplify build environment in the cloud | Rebuild the web app; test the URL, the map requests and CORS |
| Container, compose, hosting, infra | `Dockerfile`, `compose.yaml`, `amplify.yml`, `infra/` | Build the image and run the release checks in `infra/RUNBOOK.md` |
| Demo behaviour | `apps/simulator/scenarios/*.json` | Seeded expectations, plausible speeds, real-time clock |

## The routine loop

1. Branch, and run the app locally (`npm run dev`).
2. Change the smallest relevant file. Vite reloads ordinary UI edits on its own.
3. Look at the affected screen at a narrow mobile width and at a desktop width.
4. Run the checks that match what you touched. Text and spacing need
   `npm run lint` and a look; maths, authorisation and persistence need
   `npm test` too.
5. Review the diff, commit the files you meant to change, and push the branch.

## Worked examples

**Change the accent colour.** Edit `--color-accent`, `--color-accent-hover` and
`--color-accent-soft` together in `tokens.css`, then the route line colour in
`MapView.tsx` (`addRouteLayers`, the `route-line` paint). Do not search and
replace every green hex. Check white button text, the selected stop row, the
route line against the map, and that every status still reads correctly in
words — colour never carries meaning on its own here.

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

**Replace the approximate route geometry.** Run
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
