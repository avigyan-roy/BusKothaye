# 30-day AWS cost model

**Budget: US$50 total for 30 days of demo and testing.** Not $50 a month, not
$50 of usage on top of credits. Operating target US$35, leaving US$15 of
contingency for taxes, retries and the things a model gets wrong.

Reproduce every number here:

```bash
node scripts/cost-model.mjs                          # the capacity you chose
node scripts/cost-model.mjs --cadence 5 --duty 0.5   # any variation
```

The script is the source of truth; this page explains what it says. Rates marked
**CHECK** in the script are not confirmed for `ap-south-1` and must be re-read on
the day you deploy.

## The headline

Your chosen capacity — **10 buses reporting every 3 s, 50 viewers polling every
1 s, demo continuously ON for 30 days** — does not fit in $50 on the current
design. It is not close:

| Configuration | 30-day total |
|---|---|
| Current design, App Runner 1 vCPU / 2 GB | **$590** |
| Current design, Lightsail $5 instance | **$524** |
| Optimised data model, Lightsail | $109 |
| Lean (optimised + selective logging), Lightsail | $85 |
| Lean at 5 s demo cadence | $75 |
| Lean at 5 s, demo ON 12 h/day | $67 |

The last three are still over, but the reason changes completely, and that
matters for what to do about it.

## Where the money actually goes

### 1. The state item is far too large to write 8.6 million times

This is the finding that matters most, and it is a defect in what I built
earlier, not a property of the product.

Every accepted location report does one conditional write of the whole journey
snapshot. That snapshot currently carries the diagnostics rings *inside* it — up
to 100 decisions, 50 debug events, 20 public events and 24 contributor records —
so it runs to roughly 20 KB. DynamoDB bills writes in 1 KB units, so each report
costs about 20 write units instead of 2.

At 10 buses every 3 s that is 8.64 M reports over 30 days, and **181 M write
units — $261**. Moving the rings into their own bounded items takes the snapshot
to about 1.5 KB and the same traffic to $25.

The same size hurts reads. A strongly consistent read bills per 4 KB, so a 20 KB
item costs 5 read units, and 50 viewers polling every second is 648 M read units
— **$186**. Serving all viewers of a journey from one authoritative read per
second brings that to $7.45. Derived passenger state is a pure function of the
snapshot and the clock, so a one-second cache cannot show anything the database
did not say.

Together those two changes take DynamoDB from **$447 to $32**.

### 2. Logging every viewer poll costs more than the server

One structured log line per request, at ~300 bytes, across 129.6 M polls is
about 39 GB of ingestion — **$25**, five times the price of the machine. A
successful state poll is not worth storing. Logging mutations, rejections and
errors only takes it to under $1.

### 3. App Runner is the wrong shape for an always-on demo

App Runner bills provisioned memory continuously and vCPU whenever it is
handling requests. With 50 viewers polling every second it is never idle, so a
1 vCPU / 2 GB service costs about **$71 for 30 days** — more than the entire
budget, before a single database request.

App Runner *is* available in Mumbai (added November 2023), but the pricing page
lists no `ap-south-1` rate; the figures above use the Asia Pacific (Tokyo) rate
as a proxy.

A Lightsail instance at **$5 for the month** runs the same container and the
simulator worker on one box, with a fixed, predictable price and no per-request
compute billing. For a bounded demo that is the right trade. ECR and the
Dockerfile stay exactly as they are — only the thing that runs the image changes.

**Recommendation: Lightsail for the API and worker; keep App Runner documented
as the scale-up path.**

### 4. Google Maps and Routes must be checked separately

The AWS application costs and Google Maps Platform costs now come from separate
billing systems. `scripts/cost-model.mjs` uses an explicitly labelled planning
placeholder for dynamic map loads and does not yet include Routes-library
computations from the administrator console. Current SKU prices, regional terms,
free usage, quotas, and taxes can change.

**Check the current Maps JavaScript dynamic-map and Routes prices in the Google
Cloud billing console before enabling the key.** Set API quotas and budget alerts
there as well as the AWS budget. Do not infer the bill from tile counts: Google
bills the configured SKUs, and generating an admin route is distinct from
opening a passenger map.

## What I propose

| Setting | Value | Why |
|---|---|---|
| Compute | Lightsail $5 instance, API + worker | $5 fixed, versus $18–71 on App Runner |
| Demo fleet | 10 buses | As you chose |
| Demo cadence | 5 s, not 3 s | Saves $10 with no visible difference at city speeds |
| Passenger poll | 1 s | Unchanged; the cache makes it nearly free |
| Snapshot size | ~1.5 KB | Rings moved to their own items |
| Raw report retention | Real journeys only | Synthetic traces have no privacy or debugging value |
| Request logging | Mutations, rejections and errors | Not successful polls |
| Log retention | 7 days | Bounded on purpose |
| Demo duty cycle | Your choice | 12 h/day saves a further $7 |

That lands at **about $30 plus Google Maps/Routes usage** for 30 continuous days.

If map usage turns out to be expensive and free usage does not apply, the
next levers in order of least damage: cut the demo to 5 buses (−$7), duty-cycle
it (−$7), then raise the poll interval to 2 s, which is the first change a
passenger would actually notice.

I have not removed live tracking or the persistent fleet to make the numbers
work, and I would not propose that. The real-phone path costs almost nothing —
one driver at 3 s is 1/10th of the fleet traffic.

## Before you enable anything billed

1. Confirm the AWS `ap-south-1` rates and the current Google Maps/Routes SKUs,
   and put the selected planning rate in `scripts/cost-model.mjs`.
2. Confirm what your student account actually includes. Do not assume credits.
3. Re-run the model and check the total.
4. Record the deployment start date. The 30 days end exactly 30 days later.
5. Set a budget alert *before* provisioning. An alert tells you after the money
   is spent — it is not a cap. Pair it with the bounded fleet size, the maximum
   Lightsail plan, bounded log retention and a request quota on the map key,
   which are the things that actually limit spend.
6. Diarise the teardown date, and check the bill the day after.

## Sources

- [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/) — unit mechanics: writes bill per 1 KB, strongly consistent reads per 4 KB. No `ap-south-1` table on the page.
- [App Runner pricing](https://aws.amazon.com/apprunner/pricing/) — provisioned vs active billing; no `ap-south-1` rate listed.
- [App Runner in Mumbai](https://aws.amazon.com/about-aws/whats-new/2023/11/aws-app-runner-london-mumbai-paris-regions/) — region availability confirmed.
- [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/) — $5 instance, container plans, halved transfer allowance in Mumbai.
- [Google Maps Platform pricing](https://mapsplatform.google.com/pricing/) — verify current Maps and Routes SKU pricing, quotas, and free usage for the deployment account.
