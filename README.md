# BusKothay

BusKothay is a community bus-tracking web app for Kolkata. Passengers can open
the map without an account; signed-in drivers, conductors, and passengers can
create or join a journey and share GPS. A separately supervised demo worker can
keep a clearly labelled simulated fleet moving even when nobody has a browser
open.

The catalogue lists 20 WBTC services. **Only AC24, Patuli → Howrah currently has
tracking geometry**, and that geometry is an explicitly disclosed approximation.
The other 19 routes contain no invented coordinates.

> Deployment status: not deployed. Local compilation is verified under Node 24;
> see [PROGRESS.md](PROGRESS.md) and
> [docs/IMPLEMENTATION_CONTEXT.md](docs/IMPLEMENTATION_CONTEXT.md) for the exact
> test status and remaining external checks.

## What is included

- React, Vite, MapLibre passenger map with Amazon Location Maps V2 support.
- Username/password accounts using Node's built-in `scrypt`; no email or OTP.
- Driver/conductor/passenger roles and server-side journey ownership checks.
- Multi-phone location fusion, bounded prediction, stale/off-route/ended states,
  stop ETAs, and protected diagnostics.
- Global demo console, generation fencing, audit history, and persistent worker.
- Memory storage for quick local work and DynamoDB for durable deployments.
- A real-time scenario simulator that uses the same HTTP API as contributors.

## 1. Requirements

Install these before starting:

- Node.js **24 LTS** (`.nvmrc` contains `24`).
- npm **10.9 or newer**.
- Git.
- Optional: Docker Desktop/Engine for container and DynamoDB Local checks.
- For AWS only: AWS CLI v2, Docker, and the Lightsail Control plugin.

Check the first two:

```bash
node --version
npm --version
```

If the Node version does not begin with `v24`, use your Node version manager to
install/select Node 24 before running `npm ci`.

## 2. Run locally

All commands in this README are run from the repository root—the folder that
contains this file and the root `package.json`.

### First-time setup

```bash
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Windows PowerShell:

```powershell
npm ci
Copy-Item apps\api\.env.example apps\api\.env
Copy-Item apps\web\.env.example apps\web\.env.local
```

Create a private value of at least 32 characters and add it to
`apps/api/.env`:

```dotenv
SIMULATOR_TOKEN=replace-with-a-long-random-private-value
```

On Linux/macOS, `openssl rand -hex 32` is a convenient generator. Do not put the
real value in Git. The API and simulator worker must use exactly the same value.

### Start the API and website

```bash
npm run dev
```

Wait for `✓ API is responding`, then open:

- Website: <http://localhost:5173>
- API health: <http://localhost:3001/health>
- API readiness: <http://localhost:3001/ready>

The default API uses memory storage. Restarting it removes accounts, journeys,
and demo settings. This is intentional for the quickest local setup.

The local web environment defaults to the disclosed development basemap. To use
Amazon Location locally, edit `apps/web/.env.local`:

```dotenv
VITE_API_BASE_URL=http://localhost:3001
VITE_MAP_PROVIDER=amazon
VITE_AWS_REGION=ap-south-1
VITE_LOCATION_API_KEY=your-restricted-browser-key
```

Restart `npm run dev` after changing an environment file.

### Use the app manually

1. Open <http://localhost:5173/account?entry=crew>.
2. Create a username/password account and select **Driver**.
3. Open **Journey controls**, select AC24, and start a journey.
4. Press **Start sharing my location**. The browser asks for permission only now.
5. Open the passenger map in another tab. The journey should appear within a few
   seconds.
6. A passenger or conductor can join with the journey ID and join code. Their
   selected account role must match the role used to join.

Guests can view the entire passenger map. Accounts are needed only to control a
journey, save account-level preferences, or change the shared demo fleet.

## 3. Run the simulation

There are two simulation modes. Both create **Demo** journeys through the public
API; neither writes fake state directly to the database.

### Persistent demo fleet (recommended for demonstrations)

Keep `npm run dev` running. In a second terminal, set the same token used in
`apps/api/.env` and start the worker:

```bash
SIMULATOR_TOKEN=replace-with-the-same-private-value npm run demo:fleet
```

PowerShell:

```powershell
$env:SIMULATOR_TOKEN = 'replace-with-the-same-private-value'
npm run demo:fleet
```

Then:

1. Sign in at <http://localhost:5173/account>.
2. Open <http://localhost:5173/demo>.
3. Choose AC24, bus count, sources per bus, speed, update interval, GPS noise,
   dwell time, loop/pause/outage settings, and starting checkpoint.
4. Press **Turn demo on**.
5. Return to the map. Demo buses appear after the worker's next control poll.

The switch is global for this deployment. Turning it off generation-fences
in-flight worker requests and ends the active demo journeys. A fresh database
starts with demo OFF. If the worker restarts, its lease prevents two healthy
workers from driving the fleet at the same time.

### One measured scenario

First start the persistent worker or at least turn Demo ON in `/demo`; the API
will reject simulator-created journeys while the global switch is OFF. Then run:

```bash
SIMULATOR_TOKEN=replace-with-the-same-private-value \
  npm run simulate -- --scenario happy-multi --api http://localhost:3001
```

List scenarios:

```bash
npm run simulate -- --list
```

Run all scenarios (they run at real time and take several minutes):

```bash
SIMULATOR_TOKEN=replace-with-the-same-private-value \
  npm run simulate -- --scenario all --api http://localhost:3001
```

Results are written to `apps/simulator/out/` as JSON, CSV, and SVG. The command
exits non-zero when a declared expectation fails.

## 4. Local Docker and DynamoDB

The Compose profiles are mutually scoped so the memory and DynamoDB APIs do not
both claim port 3001.

### Memory API container

```bash
docker compose --profile memory up --build
```

Run the web app separately:

```bash
npm run dev --workspace @buskothay/web
```

### Memory API plus persistent demo worker

```bash
docker compose --profile demo up --build
```

The Compose file contains a development-only simulator token. Do not copy that
value to AWS.

### DynamoDB Local

```bash
docker compose --profile dynamodb up -d dynamodb
npm run dynamodb:init
docker compose --profile dynamodb up -d --build api-dynamodb
curl -fsS http://localhost:3001/ready
```

The named Docker volume preserves DynamoDB Local data across container restarts.
Use `docker compose down` to stop containers. Use `docker compose down -v` only
when you intentionally want to delete the local DynamoDB volume.

## 5. Checks before a release

```bash
npm run check
npm run build
npx playwright install --with-deps chromium   # once per machine
npm run test:e2e
```

Useful individual commands:

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint across the repository |
| `npm run typecheck` | TypeScript checks for every workspace |
| `npm test` | Geometry, shared, and API tests using memory storage |
| `npm run routes:validate` | Route fixture geometry/provenance validation |
| `npm run build` | Build all packages, API, worker, and web |
| `npm run build:deploy` | Guarded web deployment build; rejects localhost or missing map settings |
| `npm run test:e2e` | Playwright mobile/desktop flows |
| `npm run screenshots` | Responsive screenshots from an already running web server |

`npm run check` does not replace Docker/DynamoDB Local, real Amazon map, or
physical-phone testing. Record those separately.

## 6. AWS architecture

The low-cost 30-day setup is:

```text
Amplify Hosting (React web)
        │ HTTPS
        ▼
Lightsail Container Service, scale 1
  ├─ API container (public port 8080)
  └─ fleet-worker container (private, talks to localhost:8080)
        │
        ├─ DynamoDB on-demand table
        └─ Amazon Location Maps V2 (browser requests with restricted key)
```

One Lightsail service runs two container entries, so there is one compute bill
and exactly one worker at scale 1. Lightsail keeps deployment versions for
rollback. Confirm current Mumbai prices and Amazon Location allowances before
creating anything; [docs/COST_MODEL.md](docs/COST_MODEL.md) contains editable
assumptions, not a billing guarantee.

### AWS prerequisites and safety

1. Sign in to the intended AWS account and select **Asia Pacific (Mumbai),
   `ap-south-1`**.
2. Create AWS Budgets alerts at $25 and $40 for the $50/30-day target. Alerts do
   not stop spending.
3. Install AWS CLI v2, Docker, and `lightsailctl`.
4. Run `aws sts get-caller-identity` and confirm the account before proceeding.
5. Never paste access keys, the simulator token, or contributor capabilities into
   Git, screenshots, tickets, or chat.

Official AWS setup references are linked in [infra/RUNBOOK.md](infra/RUNBOOK.md).

### Step A — create DynamoDB

Deploy the table template:

```bash
aws cloudformation deploy \
  --region ap-south-1 \
  --stack-name buskothay-data \
  --template-file infra/01-lightsail-data.yaml
```

The table uses string `PK`/`SK` keys, on-demand billing, encryption, point-in-time
recovery, and TTL on `ttl`.

Create a dedicated IAM user for the Lightsail runtime, attach the table-only
policy in `infra/lightsail-user-policy.json` after replacing `ACCOUNT_ID`, and
create one access key. Store the two values in a password manager. This static
key is required because Lightsail container services do not expose the App
Runner-style instance role used by the older template. Delete/rotate it after
the demonstration period.

### Step B — create the Amazon Location browser key

In **Amazon Location Service → API keys**, create a key in `ap-south-1` for Maps
V2. Allow only the map actions used by the style (`GetStyleDescriptor`,
`GetTile`, `GetGlyphs`, and `GetSprites`), restrict referrers to the final
Amplify domain, set an expiry after the demo, and apply a conservative quota.

The key is public by design and is embedded in the web bundle; referrer/action/
expiry restrictions are what make it safe. Do not use an AWS access key here.

### Step C — build and push the two images

Create one Lightsail container service:

```bash
aws lightsail create-container-service \
  --region ap-south-1 \
  --service-name buskothay \
  --power micro \
  --scale 1
```

Build Linux images from the repository root:

```bash
docker build -t buskothay-api:deploy .
docker build -f Dockerfile.worker -t buskothay-worker:deploy .
```

Push them directly to the Lightsail service:

```bash
aws lightsail push-container-image --region ap-south-1 --service-name buskothay --label api --image buskothay-api:deploy
aws lightsail push-container-image --region ap-south-1 --service-name buskothay --label worker --image buskothay-worker:deploy
```

Copy the returned image names (for example `:buskothay.api.1` and
`:buskothay.worker.1`).

### Step D — deploy API and worker

Copy `infra/lightsail-deployment.example.json` outside the repository, replace
every `REPLACE_ME` value, and keep the file private because it contains runtime
credentials. Use one long random `SIMULATOR_TOKEN` in both containers. Initially
use a placeholder non-localhost CORS origin; update it after Amplify supplies the
real domain.

```bash
aws lightsail create-container-service-deployment \
  --region ap-south-1 \
  --cli-input-json file:///absolute/private/path/lightsail-deployment.json
```

Wait until the deployment is `ACTIVE`, copy the HTTPS URL, then verify:

```bash
curl -fsS https://YOUR-LIGHTSAIL-DOMAIN/health
curl -fsS https://YOUR-LIGHTSAIL-DOMAIN/ready
curl -fsS https://YOUR-LIGHTSAIL-DOMAIN/v1/routes
```

`/health` proves the process is alive; `/ready` also proves DynamoDB is reachable.

### Step E — publish the web app with Amplify

1. Put this repository in the Git provider/branch your team owns.
2. Amplify Hosting → **Create new app** → select repository and branch.
3. Select **My app is a monorepo** and enter `apps/web`.
4. Confirm `AMPLIFY_MONOREPO_APP_ROOT=apps/web`.
5. Keep the checked-in `amplify.yml` build settings.
6. Add build environment variables:

```text
VITE_API_BASE_URL=https://YOUR-LIGHTSAIL-DOMAIN
VITE_MAP_PROVIDER=amazon
VITE_AWS_REGION=ap-south-1
VITE_LOCATION_API_KEY=YOUR_RESTRICTED_LOCATION_KEY
```

7. Deploy and copy the final `https://...amplifyapp.com` origin.
8. Add an SPA rewrite from `/<*>` to `/index.html` with status `200`, while
   retaining Amplify's normal static-asset behavior.
9. Add that exact origin to the Location key referrer list.
10. Update `CORS_ORIGINS` in the private Lightsail deployment JSON and redeploy.

### Step F — production smoke test

Check all of these before sharing the URL:

- Directly refresh `/r/ac24-patuli-howrah`, `/account`, `/drive`, and `/demo`.
- Browser network panel shows Amazon style/tile requests succeeding with no 401/
  403 flood; attribution is visible.
- Create an account, sign out/in, change role, and change password.
- Start a real journey, send one browser GPS fix, view it in another browser,
  pause, rejoin, and end it.
- Turn the demo on, confirm worker buses appear and carry **Demo**, change speed/
  outage settings, then turn it off and confirm they disappear.
- Restart/redeploy the API and confirm accounts and journey state survived in
  DynamoDB.
- Test once on a physical phone over mobile data. Browser geolocation emulation
  is not a physical-device test.

## 7. Updating, rollback, and cleanup

For an update, build and push new image versions, edit the two image references
in the private deployment JSON, and create a new Lightsail deployment. Roll back
from the Lightsail **Deployments** tab by selecting the last known-good version.
Amplify keeps frontend deployment history separately.

To stop all charges after the demo:

1. Turn Demo OFF and export anything you need.
2. Delete the Amplify app.
3. Delete the Lightsail container service—**disabled services are still billed**.
4. Delete the Location API key.
5. Delete the runtime IAM access key and user.
6. Delete the CloudFormation stack. The table is retained intentionally; delete
   it manually only after confirming the data is no longer needed.
7. Check Billing/Cost Explorer the following day.

The full operational checklist, troubleshooting, and teardown commands are in
[infra/RUNBOOK.md](infra/RUNBOOK.md).

## 8. Repository map

```text
apps/api/          Express API, fusion engine, auth, DynamoDB/memory stores
apps/web/          React/Vite passenger, account, contributor, demo, diagnostics UI
apps/simulator/    Scenario runner and persistent demo fleet worker
packages/shared/   Zod API contracts, configuration constants, projection logic
packages/geometry/ Route projection and interpolation
data/routes/       AC24 geometry plus 20-route WBTC catalogue
infra/             AWS templates, policies, deployment examples, runbook
docs/              product, API, design, testing, and editing guides
```

## 9. Important limitations

- AC24 geometry and checkpoint coordinates are approximate and must be field-
  verified before being described as official.
- The app is community tracking, not an operator feed. Self-selected roles do
  not prove WBTC employment.
- Web pages cannot reliably record location while a phone is locked or the
  browser is backgrounded; the UI says so.
- Accounts have no email/phone recovery. A deployment owner must handle a lost
  password directly.
- No deployment, real map-key request, Docker image, or physical-phone test is
  claimed until it is recorded in [PROGRESS.md](PROGRESS.md).

For editable colours, copy, routes, and thresholds, see
[docs/MANUAL_EDITING.md](docs/MANUAL_EDITING.md). For contribution workflow, see
[CONTRIBUTING.md](CONTRIBUTING.md).
