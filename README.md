# BusKothay

BusKothay is a community bus-tracking web app for Kolkata. A passenger can open
the map without an account. Drivers, conductors, and passengers can create or
join a journey and share GPS after giving consent. A separately supervised demo
worker can drive clearly labelled simulated buses through the same HTTP API.

The catalogue currently contains 28 WBTC services, each with a stable display
colour. **Only AC24, Patuli → Howrah has tracking geometry**, and the app
discloses that this reference-constrained geometry is approximate. Its corridor
incorporates the three supplied AC24 map references; the other routes
deliberately contain no invented coordinates or boarding points.

> **Deployment status:** this repository has not been deployed from this
> workspace. Historical local checks are recorded in
> [PROGRESS.md](PROGRESS.md); a real Amazon Location map, AWS deployment, and
> physical-phone test still require your own AWS account and fresh verification.

## Pick the path you need

| Goal | Start here |
| --- | --- |
| Run the whole app locally with a real development map and no AWS account | [Local quick start](#local-quick-start-no-aws-account) |
| Put simulated buses on the local map | [Run the demo fleet](#run-the-demo-fleet) |
| Use the real Amazon Location basemap locally | [Use Amazon Location locally](#use-amazon-location-locally) |
| Understand or safely extend the interface design | [Design system](docs/DESIGN_SYSTEM.md) and [anti-template UI record](docs/design/ANTI_VIBE_UI.md) |
| Test containers or persistent local data | [Docker and DynamoDB Local](#docker-and-dynamodb-local) |
| Deploy the API, worker, database, map, and website to AWS | [Deploy to AWS](#deploy-to-aws) |

All commands below run from the application repository root: the directory that
contains this README and `package.json`. If you received the larger workspace,
enter the app first:

```bash
cd buskothay
```

If you cloned the application repository directly, do not run that command.

## What runs where

```text
Browser ───────────────────────────────┐
  React + Vite + MapLibre             │ HTTPS/JSON
  Amazon Location or development map │
                                      ▼
                               Node + Express API
                                      │
                ┌────────────────────┴────────────────┐
                ▼                                    ▼
      memory or DynamoDB                    persistent demo worker
```

Local defaults:

| Service | Address | Notes |
| --- | --- | --- |
| Web app | <http://localhost:5173> | Passenger map and all browser pages |
| API | <http://localhost:3001> | Real Express API |
| Liveness | <http://localhost:3001/health> | Process is running |
| Readiness | <http://localhost:3001/ready> | Storage and startup are ready |
| DynamoDB Local | <http://localhost:8000> | Only when its Compose profile is running |

## Requirements

Install:

- Node.js **24 LTS**. The repository's `.nvmrc` contains `24`.
- npm **10.9 or newer**.
- Git.
- Internet access for the first `npm ci` and for either basemap. The development
  map is credential-free, but its tiles are still downloaded from the internet.
- Optional for local persistence: current Docker Desktop or Docker Engine with
  Compose.
- Additional AWS tools are listed in [AWS prerequisites](#aws-prerequisites).

Check Node and npm:

```bash
node --version
npm --version
```

The Node result must start with `v24`. With `nvm`, run `nvm install` and then
`nvm use` from the repository root.

## Local quick start: no AWS account

This path runs the real website, API, fusion logic, route data, and MapLibre map.
It uses the public MapLibre demonstration basemap, so no AWS key is needed. The
interface labels it **Development basemap**; it is not the production AWS map.

### 1. Install and create local configuration

Linux/macOS:

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

`npm run dev` creates an ephemeral private simulator token and shares it between
the local API and worker automatically. You do not need to configure one for the
normal one-command local flow.

If you also want to run a simulator command manually, generate a stable token:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy the printed value and add this line to `apps/api/.env`:

```dotenv
SIMULATOR_TOKEN=paste-the-generated-value-here
```

This optional value overrides the ephemeral token for both processes started by
`npm run dev`. Keep it private. Do not commit `.env`, paste the token into a URL,
or reuse an AWS access key as the simulator token.

In development, the API also creates a local administrator with username
`admin` and password `admin` when `ADMIN_USERNAME` and `ADMIN_PASSWORD` are
omitted. Those deliberately simple credentials are for local work only. The
production process requires explicit credentials and rejects `admin` / `admin`.

The copied web configuration is already correct for the credential-free map:

```dotenv
VITE_API_BASE_URL=http://localhost:3001
VITE_MAP_PROVIDER=demo
VITE_AWS_REGION=ap-south-1
VITE_LOCATION_API_KEY=
```

### 2. Start the API, web app, and demo worker

```bash
npm run dev
```

Wait for this line:

```text
✓ API is responding at http://localhost:3001
```

Then open <http://localhost:5173>. You should see the AC24 route, selected
checkpoints, and the honest **No active bus** state over an interactive map. The
worker is already waiting for an administrator to dispatch a fleet; no second
terminal is needed.

The default API uses memory storage. Restarting it removes local accounts,
journeys, sessions, and demo settings. Use DynamoDB Local when you need restart
persistence.

### 3. Know the useful pages

| Page | What to test |
| --- | --- |
| <http://localhost:5173/> | Passenger map; redirects to AC24 |
| <http://localhost:5173/r/ac24-patuli-howrah> | Direct route link and stop selection |
| <http://localhost:5173/account> | Register, sign in, change role/password |
| <http://localhost:5173/drive> | Start/join a journey and share GPS |
| <http://localhost:5173/admin> | Sign in to the restricted demo administrator account |
| <http://localhost:5173/demo> | Admin-only route and fleet dispatch console |
| `/ops/<journey-id>` | Protected diagnostics for a journey |

### 4. Test a real browser GPS journey

1. Open <http://localhost:5173/account?entry=crew>.
2. Select **Register**, use a password of at least 10 characters, and choose
   **Driver**.
3. Open **Journey controls**, keep AC24 selected, and start the journey.
4. Select **Start sharing my location** and allow browser location access.
5. Open the passenger map in a second tab. The journey should appear after the
   first accepted fix.
6. To add another source, use a second browser/session, the journey ID, and the
   join code. The selected account role must match the role used to join.
7. Pause location sharing separately from ending the journey. Only **End
   journey** ends it.

`localhost` is treated as a secure browser context. A phone opening your
computer's plain `http://192.168...` address usually cannot use geolocation;
physical-phone testing needs an HTTPS deployment or another trusted HTTPS setup.

### 5. Test passenger boarding

Boarding is available only while fresh, confirmed bus evidence places the
selected journey at the selected stop. It is not enabled by an ETA prediction
alone.

1. In a separate browser profile or private window, register or sign in with the
   **Passenger** role.
2. Open the route map, select the journey and the stop where the bus is currently
   confirmed, and wait for **I boarded this bus** to appear.
3. Select it. The onboard panel shows later checkpoints and their current ETAs.
4. Boarding itself does not request GPS. Select **Share my live location** only
   if you want that device to contribute; the browser asks for permission then.
5. Use **Pause location sharing** without leaving, or **I got off** to revoke the
   passenger capability and stop contributing.

If the bus moves away before the request reaches the server, boarding is refused
and the passenger must wait for a fresh confirmed arrival. A simulated journey
can exercise this flow, but that does not count as a physical-device or field
test.

## Run the demo fleet

The worker creates visibly labelled **Demo** journeys through the public API. It
does not write fake state directly into memory or DynamoDB. The root
`npm run dev` command already starts this worker and gives it the same private
token as the API. The worker starts while the demo is off and waits for the
administrator's dispatch command.

1. Open <http://localhost:5173/admin> and use the local `admin` / `admin`
   credentials. The **Show password** checkbox changes only the input's
   visibility; it does not expose a stored password.
2. After sign-in, the browser opens <http://localhost:5173/demo>. Passenger,
   driver, and conductor accounts do not see its menu item and cannot call its
   API; opening `/demo` without an admin session returns to `/admin`.
3. Choose a trackable route, starting checkpoint, later destination checkpoint,
   bus count, source count, update interval, noise, dwell, loop, pause, and
   outage settings. Cruise speed is constrained to 5–50 km/h.
4. Select **Dispatch demo fleet**.
5. Return to <http://localhost:5173/>. Demo buses should appear after the next
   worker poll, normally within a few seconds.
6. Turn **Outage** on to watch the position become estimated and then stale.
7. Select **End demo fleet** when finished. This fences worker requests and ends
   active demo journeys.

Only one healthy worker controls a deployment at a time. Demo starts **OFF** in
a fresh memory store or database.

If you intentionally started the API and website as separate workspace
processes instead of using root `npm run dev`, start the worker in another
terminal with the exact `SIMULATOR_TOKEN` configured for that API:

```bash
SIMULATOR_TOKEN=paste-the-same-value npm run demo:fleet
```

In PowerShell, set `$env:SIMULATOR_TOKEN` first and then run
`npm run demo:fleet`. Do not start this second worker alongside root
`npm run dev`.

### Run a measured scenario

The demo switch must be ON before a scenario can create its demo journey. The
persistent worker may be running, but it is not required for the scenario.

List available scenarios:

```bash
npm run simulate -- --list
```

Run one real-time scenario:

Linux/macOS:

```bash
SIMULATOR_TOKEN=paste-the-same-value \
  npm run simulate -- --scenario happy-multi --api http://localhost:3001
```

Windows PowerShell:

```powershell
$env:SIMULATOR_TOKEN = 'paste-the-same-value'
npm run simulate -- --scenario happy-multi --api http://localhost:3001
```

Run the full scenario library only when you have time; every HTTP scenario runs
at honest wall-clock speed and the set takes several minutes:

```bash
npm run simulate -- --scenario all --api http://localhost:3001
```

Results are written to `apps/simulator/out/` as JSON, CSV, and SVG. A failed
expectation makes the command exit non-zero.

## Use Amazon Location locally

Use this section when you want the same dark Amazon Location Maps V2 basemap
that production expects. The API can stay in local memory mode.

### 1. Create a separate development map key

1. Sign in to your AWS account and select **Asia Pacific (Mumbai),
   `ap-south-1`**.
2. Open **Amazon Location Service → API keys → Create API key**.
3. Name it `buskothay-local-map`.
4. Grant only the Maps V2 read actions needed for styles, tiles, glyphs, and
   sprites: `GetStyleDescriptor`, `GetTile`, `GetGlyphs`, and `GetSprites`.
5. Add the browser referrer `http://localhost:5173/*`. Add
   `http://127.0.0.1:5173/*` only if you actually use that address.
6. Set a short expiry and a conservative quota. This key is only for local
   development.
7. Copy the value beginning with `v1.public.`.

This is a public browser key, not an AWS access key. It is safe to be embedded
only because its actions, referrers, quota, and expiry are restricted.

### 2. Configure the web app

Edit `apps/web/.env.local`:

```dotenv
VITE_API_BASE_URL=http://localhost:3001
VITE_MAP_PROVIDER=amazon
VITE_AWS_REGION=ap-south-1
VITE_LOCATION_API_KEY=v1.public.your-restricted-key
```

Stop and restart `npm run dev`; Vite reads environment files only at startup.

### 3. Verify the map

- The **Development basemap** disclosure is gone.
- Streets and labels render in the dark Amazon style.
- The browser network panel shows successful requests to
  `maps.geo.ap-south-1.amazonaws.com` with no repeated 401/403 responses.
- The route, stops, map attribution, stop selection, and bus marker still work.

If the map is blank, first check the key's region, allowed actions, referrer
including the port, and expiry. Never fix a 403 by putting an unrestricted AWS
access key in `VITE_LOCATION_API_KEY`.

## Docker and DynamoDB Local

Stop `npm run dev` before starting a container API on port 3001, or start only
the web workspace as shown below.

### Memory API container

Terminal 1:

```bash
docker compose --profile memory up --build
```

Terminal 2:

```bash
npm run dev --workspace @buskothay/web
```

Open <http://localhost:5173> and check <http://localhost:3001/ready>.

### Memory API plus persistent demo worker

```bash
docker compose --profile demo up --build
```

Run the web workspace in a second terminal, sign in at `/admin` with the local
`admin` / `admin` account, and dispatch the fleet from `/demo`. Compose uses a
development-only simulator token for this profile; do not copy either local
credential to AWS.

### DynamoDB Local with persistent data

Start DynamoDB, create the table once, then start the DynamoDB-backed API:

```bash
docker compose --profile dynamodb up -d dynamodb
npm run dynamodb:init
docker compose --profile dynamodb up -d --build api-dynamodb
curl -fsS http://localhost:3001/ready
```

If `curl` is unavailable, open <http://localhost:3001/ready> in a browser. Run
the web workspace separately:

```bash
npm run dev --workspace @buskothay/web
```

The named volume keeps data across normal container restarts:

```bash
docker compose down
```

Only use the following when you intentionally want to erase the local DynamoDB
volume and every local account/journey in it:

```bash
docker compose down -v
```

## Checks before deployment

Run the repository checks from a clean install:

```bash
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
docker build -t buskothay-api:deploy .
docker build -f Dockerfile.worker -t buskothay-worker:deploy .
```

`npm run check` runs lint, TypeScript checks, route validation, unit/API tests,
and a production build. It does **not** prove the Docker images, DynamoDB adapter,
Amazon map, AWS deployment, or physical-phone behaviour; verify those separately.

Useful individual commands:

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint across the repository |
| `npm run typecheck` | TypeScript checks for every workspace |
| `npm test` | Geometry, shared, and memory-backed API tests |
| `npm run routes:validate` | Route geometry/provenance validation |
| `npm run build` | Build packages, API, simulator, and local-preview web bundle |
| `npm run build:deploy` | Guarded production build; rejects localhost/non-Amazon/missing key settings |
| `npm run test:e2e` | Playwright mobile and desktop flows against a local API |
| `npm run screenshots` | Responsive captures from an already running web app |

## Deploy to AWS

The repository's deployment architecture is:

```text
Amplify Hosting (React website)
        │ HTTPS
        ▼
Lightsail Container Service, Micro, scale 1
  ├─ API container (public port 8080)
  └─ demo fleet worker (private; calls localhost:8080)
        │
        ├─ DynamoDB on-demand table
        └─ Amazon Location Maps V2 (requested by the browser)
```

One Lightsail service runs both container entries. Keep scale at 1 so there is
exactly one worker. DynamoDB, not container memory, is authoritative in
production.

### AWS prerequisites

You need:

- An AWS account you are authorized to use and an owner for its spending.
- Permissions for CloudFormation, DynamoDB, IAM, Lightsail, Amazon Location,
  Amplify, and billing alerts.
- AWS CLI **v2**, Docker, and the current `lightsailctl` plugin.
- A Git repository and branch that Amplify can read.
- Node 24 and the local checks above passing.

Use your organization's normal AWS sign-in method or IAM Identity Center for
your workstation. Never place administrator credentials in this repository.

Verify the account before creating anything:

```bash
aws --version
docker version
aws sts get-caller-identity
aws configure get region
```

Use `ap-south-1` for the commands below. Confirm the account number printed by
`get-caller-identity`; deploying to the wrong account is an expensive mistake.

In **Billing and Cost Management → Budgets**, create a cost budget before
provisioning. The project assumption is USD 50 for 30 days, with alerts at USD
25 and USD 40. This is an editable estimate, not a price promise or spending
cap. Check current prices for Lightsail, DynamoDB, Amplify, and Amazon Location.

### Values used by this guide

| Item | Value |
| --- | --- |
| Region | `ap-south-1` |
| CloudFormation stack | `buskothay-data` |
| DynamoDB table | `buskothay` |
| Lightsail service | `buskothay` |
| Lightsail power/scale | `micro` / `1` |
| Public API port and health path | `8080` / `/health` |
| Amplify monorepo app root | `apps/web` |

Change a name only if you also change every matching template, policy, and
private deployment value.

### Step 1 — Create the DynamoDB table

```bash
aws cloudformation deploy \
  --region ap-south-1 \
  --stack-name buskothay-data \
  --template-file infra/01-lightsail-data.yaml
```

Verify the stack and TTL:

```bash
aws cloudformation describe-stacks \
  --region ap-south-1 \
  --stack-name buskothay-data \
  --query 'Stacks[0].{status:StackStatus,outputs:Outputs}'

aws dynamodb describe-time-to-live \
  --region ap-south-1 \
  --table-name buskothay
```

Expected: `CREATE_COMPLETE`, table `buskothay`, and TTL attribute `ttl` enabled.
The table uses on-demand billing, encryption, point-in-time recovery, and
`DeletionPolicy: Retain`.

### Step 2 — Create the table-only Lightsail runtime identity

Lightsail Container Services do not supply the App Runner-style instance role
described in older planning documents. The API therefore needs a dedicated IAM
access key limited to this DynamoDB table.

Get the account ID:

```bash
aws sts get-caller-identity --query Account --output text
```

Copy `infra/lightsail-user-policy.json` to a private location outside the Git
repository. In that private copy, replace `ACCOUNT_ID` with the value above.
Confirm the ARN ends with `table/buskothay`, then run:

```bash
aws iam create-user --user-name buskothay-lightsail-runtime

aws iam put-user-policy \
  --user-name buskothay-lightsail-runtime \
  --policy-name BusKothayTableOnly \
  --policy-document file:///absolute/private/path/lightsail-user-policy.json

aws iam create-access-key --user-name buskothay-lightsail-runtime
```

The last command shows the secret once. Store the access-key ID and secret in a
password manager. Do not put them in an `.env` file, Git, screenshots, tickets,
or chat. They will go only into a private Lightsail deployment JSON and should
be deleted or rotated after the deployment period.

### Step 3 — Create the Lightsail service

```bash
aws lightsail create-container-service \
  --region ap-south-1 \
  --service-name buskothay \
  --power micro \
  --scale 1 \
  --tags key=Project,value=BusKothay
```

Wait until the state is `READY`:

```bash
aws lightsail get-container-services \
  --region ap-south-1 \
  --service-name buskothay \
  --query 'containerServices[0].state'
```

Lightsail charges while the service is enabled **or disabled**. Delete the
service during teardown to stop its compute charge.

### Step 4 — Build and push the API and worker

Build Linux images from this repository root:

```bash
docker build -t buskothay-api:deploy .
docker build -f Dockerfile.worker -t buskothay-worker:deploy .
```

Push both images:

```bash
aws lightsail push-container-image \
  --region ap-south-1 \
  --service-name buskothay \
  --label api \
  --image buskothay-api:deploy

aws lightsail push-container-image \
  --region ap-south-1 \
  --service-name buskothay \
  --label worker \
  --image buskothay-worker:deploy
```

Each command prints a versioned name such as `:buskothay.api.1` or
`:buskothay.worker.1`. Save both exact names; they are the rollback-safe image
references used in the next step. A `lightsailctl` error means the required
plugin is missing or not on `PATH`.

### Step 5 — Deploy the API and worker

Generate a separate production simulator token and administrator password:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

Store both outputs in a password manager and keep them distinct. Choose the
administrator username as well; `buskothay-admin` is an example, not a required
or pre-created identity. Production requires both `ADMIN_USERNAME` and
`ADMIN_PASSWORD`, requires the password to contain at least 12 characters, and
refuses the local `admin` / `admin` pair.

Copy `infra/lightsail-deployment.example.json` to a private location outside
the repository. Replace every `REPLACE_ME` value:

- `api.image` and `fleet-worker.image`: the two versioned image names.
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`: the table-only runtime key.
- Both `SIMULATOR_TOKEN` values: the same new random token.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD`: the production administrator values;
  these belong only in the API container.
- `CORS_ORIGINS`: keep the supplied non-localhost placeholder until Amplify
  gives you the final web origin.
- Table and region only if you deliberately changed the defaults.

Do not commit this private JSON; it contains credentials.

The API creates the configured administrator only when that username does not
already exist. With persistent DynamoDB data, later edits to
`ADMIN_PASSWORD` do not overwrite an existing password; sign in and use the
account password-change flow to rotate it. Startup fails rather than silently
promoting a non-admin account that already owns the configured username.

```bash
aws lightsail create-container-service-deployment \
  --region ap-south-1 \
  --cli-input-json file:///absolute/private/path/lightsail-deployment.json
```

Watch the deployment:

```bash
aws lightsail get-container-services \
  --region ap-south-1 \
  --service-name buskothay \
  --query 'containerServices[0].{state:state,url:url,deployment:currentDeployment.state}'
```

When the deployment is `ACTIVE`, save the returned HTTPS URL without a trailing
slash, then verify it:

```bash
curl -fsS https://YOUR-LIGHTSAIL-DOMAIN/health
curl -fsS https://YOUR-LIGHTSAIL-DOMAIN/ready
curl -fsS https://YOUR-LIGHTSAIL-DOMAIN/v1/routes
```

All three must return 200. `/health` only proves the process is alive. A 503
from `/ready` usually means the DynamoDB table, region, access key, or IAM policy
does not match. Inspect the separate `api` and `fleet-worker` logs in the
Lightsail console.

### Step 6 — Create the production Amazon Location key

In `ap-south-1`, open **Amazon Location Service → API keys** and create
`buskothay-web`:

1. Allow only Maps V2 `GetStyleDescriptor`, `GetTile`, `GetGlyphs`, and
   `GetSprites`.
2. Set an expiry after the planned deployment period and a conservative quota.
3. If the final Amplify origin is not known yet, create the key without a broad
   permanent referrer rule, complete the first Amplify deployment, and then
   immediately restrict it to the exact Amplify domain in Step 8. Do not leave
   it unrestricted.
4. Save the public value beginning with `v1.public.` in your password manager.

Use a different key from the localhost development key. Never use the
DynamoDB runtime access key in the browser.

### Step 7 — Deploy the website with Amplify Hosting

The source must be in a Git repository/branch your team owns and Amplify can
read.

1. Open **Amplify Hosting → Create new app** and select the repository and
   branch.
2. Select **My app is a monorepo** and enter `apps/web`.
3. Confirm Amplify sets `AMPLIFY_MONOREPO_APP_ROOT=apps/web`.
4. Keep the checked-in root `amplify.yml`. It builds from `/` so the shared npm
   workspaces are available and publishes `apps/web/dist`.
5. Add these build environment variables:

   ```text
   VITE_API_BASE_URL=https://YOUR-LIGHTSAIL-DOMAIN
   VITE_MAP_PROVIDER=amazon
   VITE_AWS_REGION=ap-south-1
   VITE_LOCATION_API_KEY=v1.public.YOUR-RESTRICTED-KEY
   ```

6. Deploy. The build intentionally fails if the API points to localhost, the
   provider is not `amazon`, or the map key is missing.
7. In **Hosting → Rewrites and redirects**, add this 200 rewrite so direct
   links work without rewriting real assets:

   ```text
   Source:
   </^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>

   Target: /index.html
   Type:   200 (Rewrite)
   ```

8. Open the Amplify HTTPS URL and save its exact origin, without the trailing
   slash.

### Step 8 — Restrict the map key and allow the web origin

1. Edit the Amazon Location key and allow only the final Amplify referrer, for
   example `https://main.EXAMPLE.amplifyapp.com/*`. Remove any temporary broad
   rule.
2. In the private Lightsail deployment JSON, replace the placeholder
   `CORS_ORIGINS` with the exact Amplify origin, for example
   `https://main.EXAMPLE.amplifyapp.com` with no path or trailing slash.
3. Create another Lightsail deployment using the same image versions:

   ```bash
   aws lightsail create-container-service-deployment \
     --region ap-south-1 \
     --cli-input-json file:///absolute/private/path/lightsail-deployment.json
   ```

4. Verify CORS after the new deployment becomes `ACTIVE`:

   ```bash
   curl -i \
     -H 'Origin: https://YOUR-AMPLIFY-DOMAIN' \
     https://YOUR-LIGHTSAIL-DOMAIN/v1/routes
   ```

The response's `Access-Control-Allow-Origin` must equal the Amplify origin
exactly, not `*`.

### Step 9 — Production smoke test

Do not call the release deployed until all applicable checks pass:

- Open the site in a private/incognito window without signing in.
- Refresh `/r/ac24-patuli-howrah`, `/account`, `/drive`, `/admin`, and `/demo`
  directly. A non-admin opening `/demo` must be sent to `/admin` and must receive
  `403` from the demo API.
- In browser developer tools, confirm Amazon style, tile, sprite, and glyph
  requests succeed without a 401/403 flood and attribution remains visible.
- Register, sign out/in, change role, and change password.
- Start AC24 as a driver, grant GPS only after selecting the share button, and
  confirm another browser sees one live marker.
- At a freshly confirmed stop, board from a separate passenger account, check
  that later-stop ETAs appear, then separately start/pause GPS and select **I got
  off**. Repeat refusal checks with a driver account and after the bus leaves.
- Sign in at `/admin` with the production administrator. Dispatch the already
  deployed worker with a valid start/destination pair, verify the configured
  route colour and normal-speed movement, confirm every simulated bus says
  **Demo**, test the outage state, and end the fleet.
- Redeploy the API and confirm accounts and journey state survive in DynamoDB.
- Test once on a physical phone over mobile data with the screen awake. Browser
  geolocation emulation is not a physical-device test.

Record the tested URLs and date in your release notes. Do not expose an ops
capability, simulator token, AWS runtime key, or full map key in screenshots.

## Updating and rolling back

For an API/worker update:

1. Run the local checks and build both images.
2. Push them; record the new versioned image names.
3. Change only the image references in the private deployment JSON.
4. Create a new Lightsail deployment and run the smoke test.

Lightsail retains recent deployment versions. Redeploy the last known-good
version from **Lightsail → Deployments** if needed. Amplify keeps separate
frontend deployment history; redeploy its last green build independently.
Image rollback does not undo DynamoDB schema/data changes.

## AWS teardown

Turn Demo OFF and export anything you must retain. Then:

1. Delete the Amplify app in the Amplify console.
2. Delete the Amazon Location API key.
3. Delete the Lightsail service to stop its compute charge:

   ```bash
   aws lightsail delete-container-service \
     --region ap-south-1 \
     --service-name buskothay
   ```

4. Remove the table-only IAM key and user. First list the access-key ID:

   ```bash
   aws iam list-access-keys --user-name buskothay-lightsail-runtime
   aws iam delete-access-key --user-name buskothay-lightsail-runtime --access-key-id REPLACE_WITH_THE_LISTED_ID
   aws iam delete-user-policy --user-name buskothay-lightsail-runtime --policy-name BusKothayTableOnly
   aws iam delete-user --user-name buskothay-lightsail-runtime
   ```

5. Delete the CloudFormation stack:

   ```bash
   aws cloudformation delete-stack \
     --region ap-south-1 \
     --stack-name buskothay-data
   ```

The table is retained by design. Delete it only after confirming its data is no
longer needed:

```bash
aws dynamodb delete-table --region ap-south-1 --table-name buskothay
```

Check Billing/Cost Explorer the next day. Remove the budget only after all
resources and unexpected charges have been reviewed.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Web says route information cannot be loaded | API terminal error, port 3001, `VITE_API_BASE_URL`, then `/health` |
| API exits during startup | Invalid value in `apps/api/.env`, missing route directory, or port already in use |
| Production API rejects its configuration | Set both `ADMIN_USERNAME` and a unique `ADMIN_PASSWORD` of at least 12 characters; never use `admin` / `admin` |
| Admin login fails after changing a deployment variable | A persisted admin keeps its current password; use the signed-in password-change flow instead of expecting bootstrap to overwrite it |
| Demo shows a capability/session error after a local restart | Refresh `/demo`. The console now removes the stale memory-mode session and returns to `/admin`; sign in again with the current administrator credentials. |
| Demo worker says token missing/unauthorized | Root `npm run dev` shares a token automatically. For separately started API/worker processes, set the same `SIMULATOR_TOKEN` in both environments. |
| Demo worker runs but no buses appear | Sign in at `/admin`, open `/demo`, select a trackable route and valid start/end checkpoints, then dispatch the fleet |
| Local map is blank | Internet/WebGL, provider, key region, map actions, referrer/port, expiry |
| Amplify build fails on configuration | All four `VITE_*` variables and `AMPLIFY_MONOREPO_APP_ROOT=apps/web` |
| Browser gets a CORS error | Exact Amplify origin in `CORS_ORIGINS`; redeploy API after changing it |
| Lightsail `/health` works but `/ready` is 503 | DynamoDB table/region, runtime key, or table-only IAM policy |
| Deep link is 404 in Amplify | Add the SPA 200 rewrite from Step 7 |
| `push-container-image` cannot run | Install AWS CLI v2 and `lightsailctl`, then ensure both are on `PATH` |

## Configuration reference

The safe templates are `apps/api/.env.example` and `apps/web/.env.example`.
Important production settings are:

| Setting | Local | AWS |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` |
| `PORT` | `3001` | `8080` |
| `DATA_DRIVER` | `memory` | `dynamodb` |
| `DYNAMODB_TABLE` | `buskothay-dev` | `buskothay` |
| `CORS_ORIGINS` | `http://localhost:5173` | exact Amplify origin |
| `ROUTE_DATA_DIR` | `data/routes` | `/app/data/routes` |
| `TRUST_PROXY_HOPS` | `0` | `1` for the checked-in Lightsail deployment |
| `ADMIN_USERNAME` | omitted; defaults to `admin` | required server-only administrator name |
| `ADMIN_PASSWORD` | omitted; defaults to `admin` | required server-only unique password, at least 12 characters |
| `VITE_API_BASE_URL` | `http://localhost:3001` | Lightsail HTTPS origin |
| `VITE_MAP_PROVIDER` | `demo` or `amazon` | `amazon` |
| `VITE_AWS_REGION` | `ap-south-1` | map-key region |
| `VITE_LOCATION_API_KEY` | blank or restricted local key | restricted production browser key |

Every `VITE_*` value is public in the compiled JavaScript. AWS access keys,
administrator credentials, session capabilities, join codes, and simulator
tokens never belong in them.

## More documentation

- [AWS runbook](infra/RUNBOOK.md) — concise operator checklist.
- [Deployment design and environment contract](docs/DEPLOYMENT_INSTRUCTIONS.md).
- [Testing and acceptance](docs/TESTING_AND_ACCEPTANCE.md).
- [Current implementation limits](docs/IMPLEMENTATION_CONTEXT.md).
- [Design system](docs/DESIGN_SYSTEM.md) and [anti-template UI record](docs/design/ANTI_VIBE_UI.md).
- [Manual editing guide](docs/MANUAL_EDITING.md).
- [Contributing workflow](CONTRIBUTING.md).
- Official AWS references: [Lightsail container tooling](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-install-software.html), [push container images](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-pushing-container-images.html), [Amazon Location API keys](https://docs.aws.amazon.com/location/latest/developerguide/using-apikeys.html), [Amplify monorepos](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html), and [Amplify SPA rewrites](https://docs.aws.amazon.com/amplify/latest/userguide/redirect-rewrite-examples.html).
