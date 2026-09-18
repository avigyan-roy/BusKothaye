# AWS deployment runbook

**Status: not deployed.** These templates and steps have been written and
reviewed, but no AWS resources have been created from them by the build. Nothing
below should be described as done until someone has run it and looked at the
resulting resources in the console.

Placeholders are account-specific values you supply: `<ACCOUNT_ID>`,
`<REGION>` (default `ap-south-1`), `<AMPLIFY_ORIGIN>`, `<IMAGE_TAG>`.

Never paste an AWS secret key into a chat, a commit, or a support ticket. The API
takes its credentials from the App Runner instance role; there are no static keys
anywhere in this repository.

## Before you start

- An AWS account your team owns, with a named budget owner.
- The AWS CLI signed in with permission to create DynamoDB tables, IAM roles, ECR
  repositories and App Runner services.
- Docker, to build the image.
- A **budget alert** on the account. An alert is not a spending cap; it tells you
  after the money is spent. Set it before you create anything chargeable.

## 1. Data layer

```bash
aws cloudformation deploy \
  --region <REGION> \
  --stack-name buskothay-data \
  --template-file infra/01-data.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides TableName=buskothay
```

Then check, in the console, that:

- the table exists, is on-demand, and has TTL enabled on the `ttl` attribute;
- the instance role's policy names the table's ARN and no wildcard resource;
- the ECR repository has immutable tags.

## 2. Build and push the image

Tag from the commit. A mutable tag such as `latest` makes a rollback ambiguous.

```bash
TAG="git-$(git rev-parse --short HEAD)"
REPO=$(aws cloudformation describe-stacks --region <REGION> \
  --stack-name buskothay-data \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" --output text)

# Build from the repository root so shared packages and route data are included.
docker build -t "$REPO:$TAG" .

aws ecr get-login-password --region <REGION> \
  | docker login --username AWS --password-stdin "$REPO"
docker push "$REPO:$TAG"
```

Before pushing, confirm the image actually works:

```bash
docker run --rm -p 3001:8080 -e DATA_DRIVER=memory "$REPO:$TAG"
curl -fsS http://localhost:3001/health
curl -fsS http://localhost:3001/v1/routes/ac24-patuli-howrah | head -c 200
```

A container that starts but cannot resolve `@buskothay/shared`, or cannot find
the route data, is not a working image — and a source checkout will not show you
either problem.

## 3. Amazon Location map key

Console-only; there is no template for this.

1. Amazon Location → API keys → Create key, in `<REGION>`.
2. Allowed actions: the map tile actions only (`geo-maps:GetTile`,
   `geo-maps:GetStaticMap` if you use static maps). Not routing, not places.
3. Referrers: the Amplify production and preview origins. Put `localhost` in a
   **separate** development key, not this one.
4. Expiry: past your demonstration period, not "never".
5. Copy the key into the Amplify build environment as `VITE_LOCATION_API_KEY`.

Then open the deployed site and watch the network panel: tiles, glyphs and
sprites must all return 200. Creating a key is not evidence that the map works.

## 4. API service

```bash
aws cloudformation deploy \
  --region <REGION> \
  --stack-name buskothay-api \
  --template-file infra/02-service.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
      DataStackName=buskothay-data \
      ImageTag="$TAG" \
      CorsOrigins="<AMPLIFY_ORIGIN>" \
      AwsRegionForData=<REGION>
```

Wait for the service to reach `RUNNING`, then take the URL from the stack
outputs and exercise the real thing:

```bash
API=$(aws cloudformation describe-stacks --region <REGION> \
  --stack-name buskothay-api \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" --output text)

curl -fsS "$API/health"
curl -fsS "$API/v1/routes/ac24-patuli-howrah" > /dev/null

# A real create → report → read cycle. Container liveness is not integration.
npm run simulate -- --scenario happy-multi --api "$API"
```

## 5. Web app

1. Amplify Hosting → connect your team's repository and branch.
2. Monorepo app root: `apps/web`. `amplify.yml` in this repository already sets
   `buildPath: /` so the shared packages build.
3. Node 24 in the build image.
4. Build environment variables:
   - `VITE_API_BASE_URL` = the App Runner URL from step 4
   - `VITE_MAP_PROVIDER` = `amazon`
   - `VITE_AWS_REGION` = `<REGION>`
   - `VITE_LOCATION_API_KEY` = the key from step 3
   The build fails rather than shipping a bundle that points at localhost.
5. Add a rewrite so deep links refresh, without swallowing asset 404s:

   | Source | Target | Type |
   | --- | --- | --- |
   | `</^[^.]+$\|\.(?!(css\|gif\|ico\|jpg\|js\|png\|txt\|svg\|woff\|woff2\|ttf\|map\|json\|webmanifest)$)([^.]+$)/>` | `/index.html` | 200 (Rewrite) |

   Check afterwards that `/r/ac24-patuli-howrah`, `/drive` and `/ops/<id>` all
   reload directly, **and** that a missing asset still returns 404 rather than
   the HTML shell.
6. Security headers: set them, then test the map. MapLibre uses a worker, so a
   copied-in CSP that forbids `worker-src blob:` will break the map silently.

## 6. Close the loop

- Add the final Amplify origin to `CORS_ORIGINS` on the App Runner service and
  redeploy it. Test a preflight (`OPTIONS`) request from the browser.
- Add the same origin to the map key's referrers.
- Run one labelled simulator scenario against the deployed API and save the
  scorecard with the results.
- Open the site on a phone on mobile data, and — only after consenting — share a
  real GPS position. A browser geolocation override is not a phone test, and this
  runbook will not let you record it as one.

## Rollback

Keep the previous image tag and the previous Amplify deployment. To roll the API
back, redeploy `02-service.yaml` with the earlier `ImageTag`. Schema changes are
backward compatible by default (`schemaVersion` on every DTO); if a rollback
would lose data, write a migration instead of swapping images and hoping.

## Teardown

```bash
aws cloudformation delete-stack --region <REGION> --stack-name buskothay-api
# The table is RETAINed on purpose. Delete it by hand, once you are sure.
aws cloudformation delete-stack --region <REGION> --stack-name buskothay-data
```

Also delete the Amplify app, the Location API key, and any images left in ECR.
Check the bill the following day rather than assuming the teardown was complete.
