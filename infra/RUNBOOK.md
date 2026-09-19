# BusKothay AWS deployment runbook

This runbook deploys the current repository to `ap-south-1` using:

- Amplify Hosting for the React site.
- One Lightsail Container Service with two containers: API and demo worker.
- One DynamoDB on-demand table.
- Amazon Location Maps V2 with a restricted browser API key.

Nothing here has been applied to an AWS account from this workspace. Read every
command before running it, replace placeholders, and record the actual outputs.

## 1. Prepare and set spending alerts

Install Node 24, npm, Docker, AWS CLI v2, and the Lightsail Control
(`lightsailctl`) plugin. Verify the target account and region:

```bash
aws --version
docker version
aws sts get-caller-identity
aws configure get region
```

Use `ap-south-1`. In **Billing and Cost Management → Budgets**, create a monthly
cost budget for USD 50 with notifications at USD 25 and USD 40. A budget is an
alert, not a hard cap. Confirm current DynamoDB, Lightsail, Amplify, and Location
rates using the AWS Pricing Calculator before provisioning.

Run the local acceptance checks first:

```bash
npm ci
npm run check
npm run test:e2e
docker build -t buskothay-api:deploy .
docker build -f Dockerfile.worker -t buskothay-worker:deploy .
```

Do not deploy an image that has not passed these checks on a machine with Docker.

## 2. Create the DynamoDB table

```bash
aws cloudformation deploy \
  --region ap-south-1 \
  --stack-name buskothay-data \
  --template-file infra/01-lightsail-data.yaml
```

Verify:

```bash
aws cloudformation describe-stacks \
  --region ap-south-1 \
  --stack-name buskothay-data \
  --query 'Stacks[0].Outputs'

aws dynamodb describe-time-to-live \
  --region ap-south-1 \
  --table-name buskothay
```

Expected: stack status `CREATE_COMPLETE`, billing mode `PAY_PER_REQUEST`, and TTL
attribute `ttl` enabled. The template retains the table if the stack is deleted,
so teardown cannot silently destroy data.

## 3. Create the least-privilege runtime identity

Lightsail Container Services do not use the App Runner instance role from the
legacy template. The AWS SDK therefore needs a dedicated access key in the API
container environment. Limit it to this one table and rotate/delete it after the
demo.

Get the account ID:

```bash
aws sts get-caller-identity --query Account --output text
```

Copy `infra/lightsail-user-policy.json` to a private temporary location, replace
`ACCOUNT_ID`, and check that the table name and region match. Then:

```bash
aws iam create-user --user-name buskothay-lightsail-runtime

aws iam put-user-policy \
  --user-name buskothay-lightsail-runtime \
  --policy-name BusKothayTableOnly \
  --policy-document file:///absolute/private/path/lightsail-user-policy.json

aws iam create-access-key --user-name buskothay-lightsail-runtime
```

The last command displays the secret once. Put both values in a password manager.
Do not put them in `.env`, Git, chat, or the example JSON in this repository.

## 4. Create the Amazon Location key

Console steps are safest because AWS shows the currently supported Maps V2
action names and quotas:

1. Open **Amazon Location Service** in Mumbai.
2. Open **API keys** and create a key named `buskothay-web`.
3. Restrict it to Maps V2 descriptor, tile, sprite, and glyph read actions only.
4. Initially allow only your Amplify preview/main domains. Add localhost only to
   a separate development key.
5. Set an expiry just after the planned demo period.
6. Set a usage quota that fits the checked cost model.
7. Save the key in your password manager/build configuration.

This is a public browser key—not an AWS access key. It is expected to appear in
the built JavaScript, so restrictions and expiry are mandatory.

## 5. Create the Lightsail service

Create one Micro service at scale one. A single deployment can contain both
containers and expose only the API:

```bash
aws lightsail create-container-service \
  --region ap-south-1 \
  --service-name buskothay \
  --power micro \
  --scale 1 \
  --tags key=Project,value=BusKothay
```

Wait until ready:

```bash
aws lightsail get-container-services \
  --region ap-south-1 \
  --service-name buskothay \
  --query 'containerServices[0].state'
```

Lightsail charges while a service is enabled **or disabled**. Delete it at the
end of the demo to stop compute billing.

## 6. Push API and worker images

Build from the repository root:

```bash
docker build -t buskothay-api:deploy .
docker build -f Dockerfile.worker -t buskothay-worker:deploy .
```

Push:

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

Record the returned names, including version numbers. Never deploy `latest` when
you need a dependable rollback.

## 7. Create the two-container deployment

Generate a simulator token and a separate administrator password:

```bash
openssl rand -hex 32
openssl rand -base64 24
```

Save both values in a password manager. Choose a production administrator
username as well; do not use the development `admin` / `admin` pair. The API
requires both `ADMIN_USERNAME` and `ADMIN_PASSWORD` in production, and the
password must contain at least 12 characters.

Copy `infra/lightsail-deployment.example.json` to a location outside the repo.
Replace:

- API and worker image versions.
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
- Both `SIMULATOR_TOKEN` values with the same generated value.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the API container only.
- Table/region values if you changed them.
- `CORS_ORIGINS`; before Amplify exists, use the supplied invalid HTTPS
  placeholder, never `*` and never localhost in production.

Deploy:

```bash
aws lightsail create-container-service-deployment \
  --region ap-south-1 \
  --cli-input-json file:///absolute/private/path/lightsail-deployment.json
```

Watch state:

```bash
aws lightsail get-container-services \
  --region ap-south-1 \
  --service-name buskothay \
  --query 'containerServices[0].{state:state,url:url,deployment:currentDeployment.state}'
```

When `currentDeployment.state` is `ACTIVE`, copy the HTTPS `url` and test:

```bash
curl -i https://YOUR-SERVICE-DOMAIN/health
curl -i https://YOUR-SERVICE-DOMAIN/ready
curl -i https://YOUR-SERVICE-DOMAIN/v1/routes
```

Expected: 200 from all three. `/ready` returning 503 means DynamoDB credentials,
region, table name, or policy is wrong. Open the Lightsail service's **Containers
→ Logs** page for separate `api` and `fleet-worker` stdout/stderr.

The configured administrator is created only if that normalized username is
missing. A colliding ordinary account makes startup fail rather than being
promoted. On later deployments, changing the environment password does not
overwrite an administrator already persisted in DynamoDB; rotate it through the
signed-in account password form.

## 8. Deploy the web app on Amplify

Amplify needs a repository/branch it can read. No deployment step invents or
pushes a Git remote.

1. Amplify Hosting → **Create new app** → choose the team's repository/branch.
2. Select **My app is a monorepo** and enter `apps/web`.
3. Confirm the environment variable `AMPLIFY_MONOREPO_APP_ROOT=apps/web`.
4. Amplify should detect the root `amplify.yml`; keep its artifact directory
   `apps/web/dist`.
5. Add these build variables:

```text
VITE_API_BASE_URL=https://YOUR-SERVICE-DOMAIN
VITE_MAP_PROVIDER=amazon
VITE_AWS_REGION=ap-south-1
VITE_LOCATION_API_KEY=YOUR_RESTRICTED_LOCATION_KEY
```

6. Deploy. The guarded build fails if the API still points at localhost, the
   provider is not Amazon, or the key is missing.
7. Add a rewrite in **Hosting → Rewrites and redirects** so client-side routes
   return `/index.html` with status 200. Do not rewrite actual asset files.
8. Copy the exact Amplify HTTPS origin (no trailing slash).
9. Add `https://AMPLIFY-DOMAIN/*` to the Location key's allowed referrers.
10. Put the exact origin in the API container's `CORS_ORIGINS` and create another
    Lightsail deployment using the same image versions.

Check CORS explicitly:

```bash
curl -i \
  -H 'Origin: https://YOUR-AMPLIFY-DOMAIN' \
  https://YOUR-SERVICE-DOMAIN/v1/routes
```

Expected `Access-Control-Allow-Origin` equals the Amplify origin exactly.

## 9. Acceptance test

Use a private/incognito browser as well as a signed-in browser:

- Guest opens the map and route directory without signing in.
- Route colours match the catalogue and catalogue-only routes remain visibly
  unavailable rather than receiving invented geometry.
- Amazon style, tiles, sprites, and glyphs load; attribution stays visible.
- Account register/login/logout/role/password flows work.
- Passenger, driver, and conductor accounts do not see the demo-console link,
  cannot call `/v1/demo`, and opening `/demo` sends them to `/admin`.
- The production administrator can sign in at `/admin`; `admin` / `admin` is
  refused in production.
- A driver creates AC24, grants GPS on button press, and the passenger browser
  sees a live marker and honest freshness state.
- A passenger joins and leaves without revoking driver control.
- At a fresh confirmed stop, a passenger can board, see later-stop ETAs, then
  independently start/pause location sharing and select **I got off**. A wrong
  stop, departed bus, anonymous caller, and non-passenger account are refused.
- A conductor joins and can end the journey; another account cannot take it over.
- The administrator dispatches a trackable route with a valid start and later
  destination; speed remains within 5–50 km/h. Settings change, outage produces
  stale state, and OFF ends every journey. Every simulated journey is labelled
  Demo.
- Redeploy the API and confirm account/journey records persist.
- Test one actual phone over mobile data with the screen awake. Record that
  physical test separately from Playwright's emulated location.

Do not call the deployment complete until these pass.

## 10. Update and rollback

For an API/worker release:

1. Run local checks.
2. Build and push new versioned images.
3. Update only the image names in the private deployment JSON.
4. Create a deployment and run the smoke test.

Lightsail retains recent deployment versions. On failure, open **Deployments**
and redeploy the last known-good version. Amplify keeps its own deployment
history; redeploy the last green build separately. DynamoDB schema changes must
remain backward-compatible or have a documented migration—image rollback does
not undo data changes.

## 11. Teardown

Turn Demo OFF first, then:

```bash
aws lightsail delete-container-service \
  --region ap-south-1 \
  --service-name buskothay
```

Delete the Amplify app and Location API key in their consoles. Remove the IAM
access key before deleting the user:

```bash
aws iam list-access-keys --user-name buskothay-lightsail-runtime
aws iam delete-access-key --user-name buskothay-lightsail-runtime --access-key-id REPLACE_ME
aws iam delete-user-policy --user-name buskothay-lightsail-runtime --policy-name BusKothayTableOnly
aws iam delete-user --user-name buskothay-lightsail-runtime
```

Delete the stack:

```bash
aws cloudformation delete-stack --region ap-south-1 --stack-name buskothay-data
```

The table remains because the template uses `DeletionPolicy: Retain`. After
exporting anything required, delete it explicitly only if destruction is intended:

```bash
aws dynamodb delete-table --region ap-south-1 --table-name buskothay
```

Finally, check Billing/Cost Explorer the next day and remove the budget only when
all resources and unexpected charges have been reviewed.

## Official references

- <https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-container-services.html>
- <https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-pushing-container-images.html>
- <https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-container-services-deployments.html>
- <https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html>
- <https://docs.aws.amazon.com/location/latest/developerguide/how-to-display-a-map.html>
- <https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html>
