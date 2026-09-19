# BusKothay

BusKothay is a mobile-first Kolkata bus tracker. The featured route is **AC24, Patuli → Howrah**. Passengers can find a route by stops or route number, open a Google street map, choose a stop, and see the bus position, next stops, arrival estimate, and freshness. Drivers/contributors send ordinary HTTP location reports; the API fuses them into one bounded route position.

The UI follows the supplied `buskothay-prototype final.html`: Archivo type, a near-black gridded canvas, cyan accent, compact Kolkata header, stop-first finder, light/dark themes, and a map/detail passenger layout.

## What is implemented

- React + Vite + TypeScript web app
- Google Maps JavaScript API with dark map, Advanced Markers, traffic, route/stops, bus/user positions, and confidence area
- explicit missing-key/service fallback that leaves stop and arrival text usable
- authenticated `/admin/routes` console for route identity, ordered draggable stop pins, Google-generated road paths, timetable, speed/dwell assumptions, sources, and verification flags
- Express + Zod API with shared runtime schemas
- versioned route overrides in DynamoDB cloud mode and ephemeral memory mode locally
- driver/conductor/passenger account flows, contributor GPS, protected diagnostics, and an admin-controlled Demo fleet
- pure one-dimensional route fusion, bounded estimation/stale states, deterministic ETA, simulator, and automated checks

Google Maps is the only map provider. Amazon Location and MapLibre are not part of the current application.

## Requirements

- Node.js 24 LTS (see `.nvmrc`)
- npm 10.9 or newer
- an internet connection for Google maps and route computation
- optional Google Maps browser key and map ID for the actual map; the rest of the local app works with an honest fallback when these are absent

## Run locally

From this repository root:

```bash
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API listens at `http://localhost:3001`. Root development also starts the supervised Demo fleet worker.

Local memory mode creates the development-only administrator `admin` / `admin`. Sign in at `/admin`, edit routes at `/admin/routes`, and dispatch simulated buses at `/demo`. Use different production credentials; the API rejects the development pair in production.

## Configure Google Maps locally

Create a browser key in a Google Cloud project and enable the Maps JavaScript API and the Routes functionality used by the JavaScript Routes library. Create a map ID for Advanced Markers. Restrict a development key to the exact local origins you use and only the required APIs.

Edit `apps/web/.env.local`:

```dotenv
VITE_API_BASE_URL=http://localhost:3001
VITE_GOOGLE_MAPS_API_KEY=your-referrer-restricted-browser-key
VITE_GOOGLE_MAPS_MAP_ID=your-map-id
```

Every `VITE_*` value is embedded in public browser JavaScript. Never put an AWS secret, account password, simulator token, or unrestricted service key there. Restart Vite after changing the file.

The passenger map should show Google attribution and live traffic. The route editor's **Generate road path** action makes a Google route-computation request, so use quota limits and billing alerts. A Google-generated driving path is not automatically an operator-verified bus route; inspect the complete path against route evidence before marking it verified.

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
4. Choose **Generate road path**. Google computes a high-quality driving path through the stops without reordering them.
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

Routine Playwright runs intentionally omit a billable Google key and verify the explicit fallback. Before claiming the map integration works in a release, separately smoke-test actual Google tiles, attribution, markers, traffic, route generation, approved/refused referrers, and quotas in a configured browser.

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
| `VITE_GOOGLE_MAPS_API_KEY` | Referrer- and API-restricted public browser key |
| `VITE_GOOGLE_MAPS_MAP_ID` | Google Cloud map ID; production cannot use `DEMO_MAP_ID` |

### API/runtime

Copy `apps/api/.env.example` and read its comments. Important production values include `DATA_DRIVER=dynamodb`, `AWS_REGION`, `DYNAMODB_TABLE`, exact `CORS_ORIGINS`, `SIMULATOR_TOKEN`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD`. Keep all of them out of Git.

## Deployment boundary

The repository contains Docker, worker, DynamoDB, Amplify, and infrastructure material. Follow [docs/DEPLOYMENT_INSTRUCTIONS.md](docs/DEPLOYMENT_INSTRUCTIONS.md) and [infra/RUNBOOK.md](infra/RUNBOOK.md). A successful local build is not evidence of a deployed site, Google key configuration, DynamoDB concurrency, or physical-phone behaviour. Record public URLs and release checks only after actually verifying them.
