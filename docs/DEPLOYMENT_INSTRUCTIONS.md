# Local setup and AWS deployment instructions

The implementing AI must create and verify the files described here. This guide is a specification, not evidence that resources exist. Keep the final README in sync with the commands that actually work.

## Local development must work first

Use Node 24 LTS and npm workspaces. Commit `.nvmrc`, the root lockfile, safe environment examples, and a Dockerfile. Keep root scripts running from the repository root; load API env from `apps/api/.env` explicitly and let Vite load `apps/web/.env.local`. Resolve route-data paths consistently from the repository root and include the data in the image.

The application exists at this repository root. Current prerequisites and container service selection are in [implementation context](IMPLEMENTATION_CONTEXT.md). For memory-mode development:

```bash
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
npm run dev
```

The API defaults to `http://localhost:3001` and the web app to
`http://localhost:5173`. The web app must show the AC24 route and a useful
no-journey state. Root `npm run dev` also starts the supervised fleet worker and
shares an ephemeral private token with the API automatically. Sign in at
`/admin` with the development-only `admin` / `admin` account and dispatch from
`/demo`; no second terminal is needed. The worker sends labelled simulated
journeys through the normal API and does not write state directly. A configured
`SIMULATOR_TOKEN` overrides the ephemeral token and is required when API and
worker are started separately. No AWS credentials are necessary for this local
memory-mode flow. Google map rendering and road-path generation require a
configured browser key and internet; without one, the textual route UI shows an
explicit fallback.

For a measured scenario instead of the persistent worker, first leave the fleet
control ON, then run at honest wall-clock speed:

```bash
SIMULATOR_TOKEN=paste-the-same-value \
  npm run simulate -- --scenario happy-multi --api http://localhost:3001
```

For Windows, document the equivalent copy step in PowerShell or describe copying the examples in the file manager. Scripts must not depend on an unquoted path without spaces.

## Environment contract

Document every variable and validate it at startup/build. Do not silently fall back to memory persistence or localhost APIs in a production deployment.

### API: `apps/api/.env.example`

| Variable | Local example/default | Cloud requirement |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` |
| `PORT` | `3001` | `8080`, matching the Lightsail public container port |
| `DATA_DRIVER` | `memory` | `dynamodb` |
| `AWS_REGION` | `ap-south-1` | Team's selected region; default Mumbai |
| `DYNAMODB_TABLE` | `buskothay-dev` | Actual provisioned table name |
| `DYNAMODB_ENDPOINT` | unset | Must be unset for AWS; used only for local DynamoDB |
| `CORS_ORIGINS` | `http://localhost:5173` | Exact comma-separated Amplify origins |
| `ROUTE_DATA_DIR` | `data/routes` | `/app/data/routes` in the container |
| `DEFAULT_ROUTE_ID` | `ac24-patuli-howrah` | Same verified route ID |
| `LOG_LEVEL` | `info` | `info` with token/location redaction |
| `TRAFFIC_REFRESH_ENABLED` | `false` | Reserved setting; current code has no traffic-refresh implementation |
| `TRUST_PROXY_HOPS` | `0` | Match verified deployment proxy topology; current Lightsail example sets `1` |
| `SESSION_TTL_HOURS` | `168` | Deliberately selected account-session lifetime |
| `SIMULATOR_TOKEN` | Optional for root `npm run dev`; it generates a shared ephemeral value | Required in both cloud API and worker; values must match |
| `ADMIN_USERNAME` | Omitted, so development defaults to `admin` | Required server-only production administrator name |
| `ADMIN_PASSWORD` | Omitted, so development defaults to `admin` | Required unique production password, at least 12 characters; `admin` / `admin` is rejected |
| `RATE_LIMIT_CREATE_PER_MINUTE` / `RATE_LIMIT_CREATE_BURST` | `6` / `3` | Keep production defaults unless deliberately reviewed |
| `RATE_LIMIT_JOIN_PER_MINUTE` / `RATE_LIMIT_JOIN_BURST` | `20` / `5` | Test overrides exist; do not copy elevated E2E limits into production |

The current Lightsail design uses a dedicated IAM user's access key in a private
deployment JSON because Lightsail Container Services do not attach the legacy
App Runner instance role. Limit that identity to the one DynamoDB table, keep the
private JSON outside Git/chat/screenshots, and rotate or delete the key after the
deployment period. DynamoDB Local may use dummy credentials scoped to its local
process; never ship those settings to AWS. Avoid logging the full environment
when validating it.

The API bootstraps the configured administrator before listening. If the
normalized username is missing, it stores a password hash and `isAdmin=true`.
If an ordinary account already owns that username, startup fails instead of
silently promoting it. With persistent DynamoDB data, an existing administrator
keeps their current password when the environment changes; rotate that password
through the signed-in account flow.

### Web: `apps/web/.env.example`

| Variable | Local example/default | Cloud requirement |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:3001` | Actual public HTTPS API origin |
| `VITE_GOOGLE_MAPS_API_KEY` | blank | Public browser key restricted to exact production referrers and required APIs |
| `VITE_GOOGLE_MAPS_MAP_ID` | `DEMO_MAP_ID` | Production Google Cloud map ID used by Advanced Markers |

Every `VITE_*` value is public in the built JavaScript. A browser map key is public by design; restrict it by exact HTTP referrer and to the Maps JavaScript API plus the route-computation capability the editor needs. Configure billing quotas and alerts. It is not a place for an AWS secret key, backend capability, or unrestricted service credential.

Enable Maps JavaScript API and the required Routes functionality in the selected Google Cloud project. Create a production map ID for Advanced Markers. Verify tiles, dark scheme, markers, traffic, route computation, attribution, quota, and key rejection from an unapproved origin in a browser. Credential-free builds intentionally use the in-app fallback; there is no second basemap provider.

Keep brand, default stop, and design tokens in editable source files, not an expanding list of build variables. The implemented `npm run build:deploy` validates deployment settings and rejects localhost, a missing Google key, or `DEMO_MAP_ID`. Ordinary `npm run build` creates an optimized local preview without this deployment guard; do not publish it as a configured release.

## Docker and local persistence verification

Create a multi-stage Node 24 image. Build from the **repository root** so shared packages, lockfile, and route fixtures are included. Install with `npm ci`, compile shared packages before API, and run the compiled API as a non-root user. Copy only runtime dependencies, built modules, and needed data into the final image.

Check workspace symlinks/package exports in the final image. A container that worked in a source checkout but cannot find `@buskothay/shared` is not complete. Exclude `.env*` secrets, `.git`, local caches, and tests/artifacts not needed at runtime via `.dockerignore`.

Implement and verify:

```bash
docker build -t buskothay-api:local .
docker run --rm -p 3001:8080 --env-file apps/api/.env -e PORT=8080 -e ROUTE_DATA_DIR=/app/data/routes buskothay-api:local
```

`compose.yaml` should additionally provide API + DynamoDB Local with a documented table initialization step and persistent local volume. Use a named profile if the basic memory setup is simpler. With a container API already on port 3001, start only the frontend using `npm run dev -w @buskothay/web`. Root `npm run dev` would also start an API on the same port. Select Compose services explicitly as described in the implementation context; enabling the DynamoDB profile alone also includes the memory API.

Use local persistence to test restart recovery, concurrent writers, invalid tokens, and expiry without spending cloud credits. Local Docker is not an HTTPS phone test.

## AWS provisioning deliverables

Provide concrete templates/configuration under `infra/` and a step-by-step
runbook with placeholders only for account-specific values. Include the table
definition and TTL, table-only IAM policy, Lightsail API/worker images,
two-container deployment JSON, health check, and Amplify configuration. Do not
introduce a large infrastructure framework just to add complexity.

Every required console-only action must be documented. Never claim templates were applied without checking the resulting resources. Do not assume hackathon credits, an account ID, or free usage.

### 1. DynamoDB

Create one regional on-demand table with `PK`/`SK` string keys and TTL attribute `ttl`. No GSI is necessary for the defined access patterns. Restrict API IAM permissions to the table and operations actually used: state reads/conditional writes, queries, transactional lifecycle writes, and diagnostic batches/deletes. Provisioning-only permissions do not belong in the runtime role.

The authoritative-state design is in [the backend guide](BACKEND_INSTRUCTIONS.md). Do not deploy the five-second-memory-snapshot design from the old plan instead.

### 2. Google Maps Platform

Create separate development and production browser keys. Restrict the production key to the final Amplify origins and only the enabled Maps/Routes APIs; keep localhost on the development key. Configure billing quotas and a team-owned budget alert, then create the production map ID.

Verify actual browser requests rather than merely creating a key. Open the passenger map and `/admin/routes`, confirm Google attribution remains visible, drag a stop, generate a road path through all ordered stops, inspect the entire AC24 alignment, and publish only after its verification flags are truthful. Review current Google Maps Platform terms before retaining generated geometry; record route identity and geometry provenance separately.

### 3. Lightsail Containers

Build both verified Linux images from the repository root: `Dockerfile` for the
API and `Dockerfile.worker` for the supervised fleet worker. Push each image to
the single Lightsail Container Service and retain the versioned names returned
by `aws lightsail push-container-image`; do not use an ambiguous `latest` tag for
a release.

Use one Micro service at scale one. Expose only the API container on port 8080
with health path `/health`; the worker is private and calls
`http://localhost:8080`. The API environment uses DynamoDB, the table-only AWS
credentials, exact CORS origins, route directory, simulator token, and explicit
production administrator credentials. The worker receives only its API base
URL, the matching simulator token, and control-poll setting. Scale one limits
duplicate workers, while the generation-scoped lease and DynamoDB conditional
writes still provide correctness during restarts and replacements.

Wait for the deployment to become `ACTIVE`, then exercise `/health`, `/ready`,
route reads, admin login, create → report → read, dispatch, and shutdown against
the real HTTPS URL. Container liveness alone is not successful integration.

### 4. Amplify Hosting

Connect the team's chosen git repository/branch. Use `apps/web` as the monorepo app root, build from the repository root so shared packages exist, and publish `apps/web/dist`.

Implement an `amplify.yml` matching these paths. `appRoot` must match `AMPLIFY_MONOREPO_APP_ROOT`; root builds use `buildPath: /`. [Official Amplify monorepo configuration](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html)

Select Node 24, run `npm ci`, build shared/geometry before the web app, and set
the real web variables. The build must not embed `http://localhost:3001`. Add a
suitable SPA rewrite so refreshing `/r/ac24-patuli-howrah`, `/account`,
`/drive`, `/admin`, `/admin/routes`, `/demo`, and `/ops/<id>` works without swallowing asset
404s.

Add the final Amplify origin to API CORS and the Google key's permitted referrers. Test preflight requests, Google assets, and route computation. If setting Content Security Policy, allow only the Google Maps origins actually observed and test it instead of pasting a policy that breaks the map. Give hashed assets long caching and the HTML shell short caching.

### 5. Logs and cost control

Use the separate Lightsail API and worker container logs for structured errors
and counters. Keep tokens, passwords, AWS credentials, and raw GPS out of
general request logs. Export to a bounded-retention log destination only after
its cost and access policy are reviewed. A small confidence/rejection dashboard
is optional after the complete app works.

Document a team-owned budget alert and a teardown procedure for chargeable demo resources. An alert is not a spending cap. Do not print or record billing/account secrets in demo material.

## Release checks

- Public web and API URLs use HTTPS and are reachable outside the development machine.
- Direct route reload, map tiles, attribution, CORS, contributor join, report ingestion, and stop selection work.
- Route directory colours match the catalogue, and unavailable routes remain disabled without invented geometry.
- `/demo` is absent from ordinary account navigation, redirects to `/admin` without an administrator session, and the API returns 403 to passenger/driver/conductor accounts.
- Production admin credentials work; the local `admin` / `admin` pair does not.
- Dispatch accepts only a trackable route and a destination after the selected start, and constrains configured speed to 5–50 km/h.
- A passenger can board only at `boardableStopId`, sees later-stop ETAs, and is asked separately before GPS starts; leaving revokes the capability.
- A labelled real-time simulator run drives the deployed map through live, estimated, stale, and recovered states.
- Changing/restarting API instances preserves committed state and valid contribution sessions.
- A phone on mobile data can view the site and, after consent, submit actual GPS. Do not call a simulated browser geolocation test a real-phone test.
- Record verified URLs and test results in README. Do not expose ops capabilities or show the complete map key on video.

## Rollback and missing credentials

Keep both previous versioned Lightsail image names and the previous Amplify
deployment available. Keep schema version changes backward compatible where
possible. If a schema rollback would lose data, explain and prepare a migration
instead of blindly swapping images.

If cloud access is missing, finish local verification, image build, environment examples, templates, and the exact setup checklist. Report “ready for AWS deployment; not deployed” with the missing account configuration. Ask for the target account/repository only when needed; never ask for secret keys in chat.
