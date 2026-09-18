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

The API defaults to `http://localhost:3001` and the web app to `http://localhost:5173`. The web app must show the AC24 route and a useful no-journey state. In another terminal:

```bash
npm run simulate -- --scenario happy-multi --api http://localhost:3001
```

The map must now show a labelled demo journey driven through the API. No AWS credentials should be necessary for this local memory-mode flow. Initial dependency download and the development basemap still require internet; do not call it fully offline.

For Windows, document the equivalent copy step in PowerShell or describe copying the examples in the file manager. Scripts must not depend on an unquoted path without spaces.

## Environment contract

Document every variable and validate it at startup/build. Do not silently fall back to memory persistence or localhost APIs in a production deployment.

### API: `apps/api/.env.example`

| Variable | Local example/default | Cloud requirement |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` |
| `PORT` | `3001` | `8080`, matching App Runner image port |
| `DATA_DRIVER` | `memory` | `dynamodb` |
| `AWS_REGION` | `ap-south-1` | Team's selected region; default Mumbai |
| `DYNAMODB_TABLE` | `buskothay-dev` | Actual provisioned table name |
| `DYNAMODB_ENDPOINT` | unset | Must be unset for AWS; used only for local DynamoDB |
| `CORS_ORIGINS` | `http://localhost:5173` | Exact comma-separated Amplify origins |
| `ROUTE_DATA_DIR` | `data/routes` | `/app/data/routes` in the container |
| `DEFAULT_ROUTE_ID` | `ac24-patuli-howrah` | Same verified route ID |
| `LOG_LEVEL` | `info` | `info` with token/location redaction |
| `TRAFFIC_REFRESH_ENABLED` | `false` | Reserved setting; current code has no traffic-refresh implementation |
| `TRUST_PROXY_HOPS` | `0` | Match verified deployment proxy topology; current service template sets `1` |
| `RATE_LIMIT_CREATE_PER_MINUTE` / `RATE_LIMIT_CREATE_BURST` | `6` / `3` | Keep production defaults unless deliberately reviewed |
| `RATE_LIMIT_JOIN_PER_MINUTE` / `RATE_LIMIT_JOIN_BURST` | `20` / `5` | Test overrides exist; do not copy elevated E2E limits into production |

AWS SDK credentials come from the runtime credential provider chain. In App Runner use the instance IAM role, never static access keys. DynamoDB Local may use dummy credentials scoped to its local process; never ship those settings to AWS. Avoid logging the full environment when validating it.

### Web: `apps/web/.env.example`

| Variable | Local example/default | Cloud requirement |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:3001` | Actual public HTTPS API origin |
| `VITE_MAP_PROVIDER` | `demo` | `amazon` |
| `VITE_AWS_REGION` | `ap-south-1` | Region of map key |
| `VITE_LOCATION_API_KEY` | blank | Restricted public browser map key |

Every `VITE_*` value is public in the built JavaScript. A browser map key is public by design; restrict permitted map actions, approved referrers, and expiry. It is not a place for an AWS secret key, backend capability, or unrestricted service credential.

Production map style follows the Maps V2 descriptor format. Verify the selected style and key permissions for descriptor, tiles, fonts/glyphs, and sprites using current AWS documentation. [AWS map integration guide](https://docs.aws.amazon.com/location/latest/developerguide/how-to-display-a-map.html)

Use `https://demotiles.maplibre.org/style.json` only as the documented development rendering fallback. [MapLibre example](https://maplibre.org/maplibre-gl-js/docs/examples/display-a-map/)

Keep brand, default stop, and design tokens in editable source files, not an expanding list of build variables. The implemented `npm run build:deploy` validates deployment settings and rejects localhost or a missing Amazon key. Ordinary `npm run build` creates an optimized local preview without this deployment guard; do not publish it as a configured AWS release.

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

Provide concrete templates/configuration under `infra/` and a step-by-step runbook with placeholders only for account-specific values. Include table definition, TTL setting, IAM policies, ECR image setup, App Runner configuration, and log retention. CloudFormation templates plus a small deployment script are sufficient; do not introduce a large infrastructure framework just to add complexity.

Every required console-only action must be documented. Never claim templates were applied without checking the resulting resources. Do not assume hackathon credits, an account ID, or free usage.

### 1. DynamoDB

Create one regional on-demand table with `PK`/`SK` string keys and TTL attribute `ttl`. No GSI is necessary for the defined access patterns. Restrict API IAM permissions to the table and operations actually used: state reads/conditional writes, queries, transactional lifecycle writes, and diagnostic batches/deletes. Provisioning-only permissions do not belong in the runtime role.

The authoritative-state design is in [the backend guide](BACKEND_INSTRUCTIONS.md). Do not deploy the five-second-memory-snapshot design from the old plan instead.

### 2. Amazon Location

Create a browser Maps V2 key in the chosen region, restrict actions/referrers, and set expiry beyond the intended demonstration period. Include both actual preview and main domains only where required; localhost belongs in a separate development configuration.

Verify actual map requests in the browser, not merely key creation. Generate and inspect the AC24 geometry once; retain compliant attribution and data provenance. Optional Routes V2 traffic calls use the backend instance role and timeouts.

### 3. ECR and App Runner

Build and push the verified image with an immutable commit-derived tag, then deploy App Runner from ECR. Keep ECR pull permissions/access role separate from the application's instance role for DynamoDB and optional routing.

Configure port 8080, health path `/health`, all API environment values, and initial `MinSize=1`, `MaxSize=1`. This is a small demo capacity choice, not a guarantee of permanent process memory or zero downtime. DynamoDB conditional writes handle concurrent/replacement instances.

Wait for service readiness, then exercise create → report → read against the real HTTPS URL. Container liveness alone is not successful integration. Keep automatic API redeploys disabled during a demo recording; use an intentional release after checks pass.

Do not add a VPC connector unless the app actually needs private VPC resources. This stack's normal DynamoDB/Location API access does not require an RDS-style private database network.

### 4. Amplify Hosting

Connect the team's chosen git repository/branch. Use `apps/web` as the monorepo app root, build from the repository root so shared packages exist, and publish `apps/web/dist`.

Implement an `amplify.yml` matching these paths. `appRoot` must match `AMPLIFY_MONOREPO_APP_ROOT`; root builds use `buildPath: /`. [Official Amplify monorepo configuration](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html)

Select Node 24, run `npm ci`, build shared/geometry before the web app, and set the real web variables. The build must not embed `http://localhost:3001`. Add a suitable SPA rewrite so refreshing `/r/ac24-patuli-howrah`, `/drive`, and `/ops/<id>` works without swallowing asset 404s.

Add the final Amplify origin to API CORS and the key's permitted referrers. Test preflight requests and map assets. Set sensible security headers compatible with MapLibre's installed worker/CSP requirements; test them instead of pasting a policy that breaks the map. Give hashed assets long caching and the HTML shell short caching.

### 5. Logs and cost control

Use App Runner's CloudWatch logs for structured errors and counters. Set bounded log retention. Keep tokens and raw GPS out of general request logs. A small confidence/rejection dashboard is optional after the complete app works.

Document a team-owned budget alert and a teardown procedure for chargeable demo resources. An alert is not a spending cap. Do not print or record billing/account secrets in demo material.

## Release checks

- Public web and API URLs use HTTPS and are reachable outside the development machine.
- Direct route reload, map tiles, attribution, CORS, contributor join, report ingestion, and stop selection work.
- A labelled real-time simulator run drives the deployed map through live, estimated, stale, and recovered states.
- Changing/restarting API instances preserves committed state and valid contribution sessions.
- A phone on mobile data can view the site and, after consent, submit actual GPS. Do not call a simulated browser geolocation test a real-phone test.
- Record verified URLs and test results in README. Do not expose ops capabilities or show the complete map key on video.

## Rollback and missing credentials

Keep the previous image tag and previous Amplify deployment available. Keep schema version changes backward compatible where possible. If a schema rollback would lose data, explain and prepare a migration instead of blindly swapping images.

If cloud access is missing, finish local verification, image build, environment examples, templates, and the exact setup checklist. Report “ready for AWS deployment; not deployed” with the missing account configuration. Ask for the target account/repository only when needed; never ask for secret keys in chat.
