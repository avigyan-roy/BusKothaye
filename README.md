# BusKothay

BusKothay is a mobile-first Kolkata bus tracker. The featured route is **AC24, Patuli → Howrah**. Passengers can find a route by stops or route number, open an Amazon Location street map, choose a stop, and see the bus position, next stops, arrival estimate, and freshness. Drivers/contributors send ordinary HTTP location reports; the API fuses them into one bounded route position.

The UI follows the supplied `buskothay-prototype final.html`: Archivo type, a near-black gridded canvas, cyan accent, compact Kolkata header, stop-first finder, light/dark themes, and a map/detail passenger layout.

## What is implemented

- React + Vite + TypeScript web app
- Amazon Location Maps V2 rendered by MapLibre GL JS, with light/dark map styles, live traffic, route/stops, bus/user positions, and a real-metre confidence area
- explicit missing-key/service fallback that leaves stop and arrival text usable
- authenticated `/admin/routes` console for route identity, ordered draggable stop pins, Amazon Location Routes V2 road paths, timetable, speed/dwell assumptions, sources, and verification flags
- Express + Zod API with shared runtime schemas
- versioned route overrides in DynamoDB cloud mode and ephemeral memory mode locally
- driver/conductor/passenger account flows, contributor GPS, protected diagnostics, and an admin-controlled Demo fleet
- pure one-dimensional route fusion, bounded estimation/stale states, deterministic ETA, simulator, and automated checks

Amazon Location Service is the only street-map and route-computation provider. MapLibre is the renderer for Amazon's Maps V2 style; the missing-key/test surface contains no third-party tiles and is never presented as a street map.

## Requirements

- Node.js 24 LTS (see `.nvmrc`)
- npm 10.9 or newer
- an internet connection for Amazon Location maps and route computation
- optional restricted Amazon Location browser key for actual streets and route generation; the rest of the local app works with an honest basemap-free fallback when it is absent

## Run locally

From this repository root:

```bash
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run dev
```

PowerShell equivalents for the two copy steps are:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
```

Open [http://localhost:5173](http://localhost:5173). The API listens at `http://localhost:3001`. Root development also starts the supervised Demo fleet worker.

Local memory mode creates the development-only administrator `admin` / `admin`. Sign in at `/admin`, edit routes at `/admin/routes`, and dispatch simulated buses at `/demo`. Use different production credentials; the API rejects the development pair in production.

## Configure Amazon Location locally

Create an Amazon Location API key in `ap-south-1` (or your configured region). Allow only Maps V2 read actions and Routes V2 `CalculateRoutes`, restrict it to the exact local/production HTTP referrers, set an expiry, and set quotas/budget alerts. Use separate development and production keys.

Edit `apps/web/.env.local`:

```dotenv
VITE_API_BASE_URL=http://localhost:3001
VITE_MAP_PROVIDER=amazon
VITE_AWS_REGION=ap-south-1
VITE_LOCATION_API_KEY=your-referrer-and-action-restricted-public-key
```

Every `VITE_*` value is embedded in public browser JavaScript. Never put an AWS secret, account password, simulator token, or unrestricted service key there. Restart Vite after changing the file.

The passenger map should show Amazon/provider attribution and live traffic. The route editor's **Generate road path** action makes an Amazon Location Routes V2 request, so use quota limits and billing alerts. An Amazon-generated driving path is not automatically an operator-verified bus route; inspect the complete path against route evidence before marking it verified.

## Passenger and operator paths

| Path | Purpose |
| --- | --- |
| `/` | Stop-and-route finder from the supplied prototype |
| `/r/ac24-patuli-howrah` | Passenger map and live route detail |
| `/drive` | Start/join a journey and share GPS after consent |
| `/account` | Account role/password/session controls |
| `/admin` | Administrator sign-in |
| `/admin/routes` | Route, stop, map, timetable, and provenance editor |
| `/demo` | Administrator Demo fleet dispatch |
| `/ops/:journeyId` | Protected journey diagnostics |

## Route administration

1. Sign in as an administrator and open `/admin/routes`.
2. Select an existing route or choose **Add bus route**.
3. Name and order the stops. Drag numbered pins, edit coordinates, or add a pin by clicking the map.
4. Choose **Generate road path**. Amazon Location Routes V2 computes a driving path through the ordered stops.
5. Inspect the whole line, timetable, source and notes. Mark the route and stop pins verified only when the evidence supports that statement.
6. Choose **Publish route**. The browser sends a new immutable route version; the server validates stop ordering, line proximity, segments, and timetable before activation.

Cloud mode stores published overrides under the route configuration partition in DynamoDB and reloads them before serving traffic. Memory mode resets route edits when the API restarts. The committed files in `data/routes/` remain the reviewed seed and recovery baseline.

## Checks

```bash
npm run lint
npm run typecheck
npm run routes:validate
npm test
npm run build
```

`npm run check` runs those core gates together. Browser tests are separate:

```bash
npx playwright install chromium
npm run test:e2e
```

That default run omits the persistent fleet-worker scenario. Run the complete
mobile/desktop suite, including administrator fleet dispatch, with:

```bash
E2E_FLEET_WORKER=true npm run test:e2e
```

In PowerShell, use `$env:E2E_FLEET_WORKER='true'; npm run test:e2e`.

Routine Playwright runs intentionally omit a billable Amazon Location key and verify the explicit basemap-free fallback. Before claiming the map integration works in a release, separately smoke-test actual Amazon tiles, attribution, markers, traffic, route generation, approved/refused referrers, key actions, expiry, and quotas in a configured browser.

The repository requires Node 24. Running checks on an older Node version may work by accident but is not the supported verification environment.

## Data and honesty

WBTC's published route list identifies AC24 from Patuli to Howrah via Ruby, Gariahat, Hazra, Exide, Park Street, and Esplanade. The bundled line and eight checkpoints are still labelled approximate until boarding pins and the full road alignment are verified. They are selected checkpoints, not a claim to list every official stop.

No WBTC live feed or verified public timetable is bundled. Demo buses always say **Demo**. Missing, pending, estimated, stale, off-route, disconnected, and ended states are explicit; the app does not invent a bus marker or arrival time.

See:

- [route and source brief](docs/ROUTE_AND_CONTENT.md)
- [decision record](docs/DECISIONS.md)
- [API contract](docs/API_CONTRACT.md)
- [design system](docs/DESIGN_SYSTEM.md)
- [manual editing guide](docs/MANUAL_EDITING.md)
- [deployment guide](docs/DEPLOYMENT_INSTRUCTIONS.md)
- [testing and acceptance](docs/TESTING_AND_ACCEPTANCE.md)

## Environment summary

### Web build

| Variable | Meaning |
| --- | --- |
| `VITE_API_BASE_URL` | Public API origin; production must be HTTPS |
| `VITE_MAP_PROVIDER` | `amazon`; `none` is test-only and deployment builds reject it |
| `VITE_AWS_REGION` | Region containing the Amazon Location API key; default `ap-south-1` |
| `VITE_LOCATION_API_KEY` | Public browser key restricted to Maps V2 reads, Routes V2 calculation, exact referrers, expiry and quota |

### API/runtime

Copy `apps/api/.env.example` and read its comments. Important production values include `DATA_DRIVER=dynamodb`, `AWS_REGION`, `DYNAMODB_TABLE`, exact `CORS_ORIGINS`, `SIMULATOR_TOKEN`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD`. Keep all of them out of Git.

## Deployment boundary

The repository contains Docker, worker, DynamoDB, Amplify, and infrastructure material. Follow [docs/DEPLOYMENT_INSTRUCTIONS.md](docs/DEPLOYMENT_INSTRUCTIONS.md) and [infra/RUNBOOK.md](infra/RUNBOOK.md). A successful local build is not evidence of a deployed site, Amazon Location key configuration, DynamoDB concurrency, or physical-phone behaviour. Record public URLs and release checks only after actually verifying them.

## Troubleshooting

- `spawn EINVAL` on Windows: pull the current `scripts/dev.mjs`. It launches npm through `process.env.npm_execpath` with Node and has a Windows shell fallback; it does not directly spawn `npm.cmd` with `shell:false`. If it still fails, include the printed child-process error and verify Node 24/npm 10.9 from the same terminal.
- The street map is a plain grid: set `VITE_MAP_PROVIDER=amazon`, `VITE_AWS_REGION`, and `VITE_LOCATION_API_KEY`, then restart Vite. Check the key region, referrer and Maps V2 actions in the browser network panel.
- **Generate road path** is disabled: the same browser key also needs the Routes V2 `CalculateRoutes` action. The control intentionally remains unavailable when AWS routing is not configured.
- API starts but the web app cannot load data: verify `VITE_API_BASE_URL`, API `CORS_ORIGINS`, and that `/health` answers on port 3001.
- Playwright has no browser: run `npx playwright install chromium` once, then rerun `npm run test:e2e`.
- Port 3001 or 5173 is busy: stop the existing BusKothay process before running root `npm run dev`; do not start a second root dev process beside the Compose API.
