# Decisions and corrections to the original plan

These decisions are part of the current build brief. They preserve the product and AWS application hosting while correcting gaps and recording explicit user changes. The original plan remains unchanged for historical reference.

## 1. Node 24 instead of Node 20

Use Node 24 LTS for development, CI, and the API container. Node's release table lists Node 20 as end-of-life and Node 24 as LTS. Pin the selected patch/tooling consistently when implementing. [Official release status](https://nodejs.org/en/about/previous-releases)

## 2. App Runner memory is a cache, not durable authority

The original assumption that a single container plus five-second snapshots is sufficient is too strong. AWS recommends stateless applications; instance memory/files are not durable, and deployments introduce replacement instances. [Runtime guidance](https://docs.aws.amazon.com/apprunner/latest/dg/develop.html), [deployment architecture](https://docs.aws.amazon.com/apprunner/latest/dg/architecture.html)

**Our implementation choice:** keep the pure fusion engine, but make DynamoDB's versioned journey state authoritative in cloud mode. Each mutation reads current state, applies a pure transition, and conditionally writes the next version. Retry conflicts within a small bound. A response claiming an accepted update follows a successful state commit. Diagnostic append logs can remain asynchronous. Memory-only mode is explicitly local/development.

Default demo capacity is `MinSize=1`, `MaxSize=1`; this limits scale but does not replace concurrency control. AWS distinguishes provisioned minimum capacity from maximum active capacity. [Autoscaling configuration](https://docs.aws.amazon.com/apprunner/latest/dg/manage-autoscaling.html)

## 3. Consensus precedes accuracy weighting

One source can control a weighted median if it has more than half of the total weight. A reported five-metre accuracy is not evidence that a phone is honest. For three or more sources, identify the majority position cluster with an unweighted robust step first, then weight its members with capped influence. Add a regression case for one unusually precise liar.

Phone identities are not independently verified, so do not claim resistance to coordinated fake contributors. Two-source disagreement and one-source tracking must visibly carry more uncertainty.

## 4. One bounded projection contract

The original frontend loop does not implement the server's limits. Share a pure projection function and include its anchor, timing, speed, and cap in the state DTO. Enforce the next-stop cap, distance cap, 90-second horizon, and stale freeze even when every poll fails.

`STALE` means the last bounded estimate is frozen; label it **Last confirmed … ago**. Do not label a predicted coordinate as a confirmed sighting. The API also returns the actual last confirmed coordinate.

## 5. Recovery search expands with elapsed time

A fixed forward search window of 600 metres can exclude a valid return after an outage. Use elapsed time and plausible maximum speed to widen candidate search, bounded by the route. Retain direction and continuity checks. Ambiguous re-entry requires confirming measurements instead of an arbitrary nearest segment.

## 6. Public data contains only the journey view

Protect `/debug` with a journey-scoped read-only ops capability or the driver capability. Public `/state` contains aggregate source counts and sanitized journey events only. Raw source IDs, positions, tokens, and join-code hashes are not public.

Deleting a contributor token does not erase IDs inside retained updates. State the retention policy honestly: opt-in, pseudonymous reports; no accounts; access revoked on leave/end; raw reports expire from application access after 48 hours. Physical DynamoDB TTL deletion is asynchronous, so filter expired records immediately in application reads. [DynamoDB expired-item behaviour](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html)

## 7. Real-time API tests run at real speed

A simulator cannot secretly accelerate the backend's server clock. Deployed HTTP scenarios run at `timeScale=1`. Pure-engine tests use an injected clock for fast time travel. For a short video, edit the recording or design a shorter scenario; do not publish accelerated results as real-time validation.

## 8. Pending, stopped, and missing data are explicit

Add `PENDING` before the first accepted fix. Cover `DWELLING → ESTIMATED → STALE → ENDED` when sources disappear. Unknown position and unknown ETA are `null`, not `[0,0]` and zero minutes. A predicted arrival at a stop does not mark it passed.

## 9. Confidence is an estimate to calibrate

Do not promise a calibrated probability from an unvalidated Kalman sigma. The UI says **Approximate accuracy**. Record empirical coverage in simulator output. Browser location accuracy is a 95% radial measure, not directly the filter's one-dimensional standard deviation; make the approximation explicit in measurement-noise code. [Geolocation accuracy definition](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy)

## 10. Google Maps, route geometry, and scheduling

Google Maps JavaScript API is the only browser map provider. The passenger view uses the Maps and Advanced Marker libraries, Google traffic, provider-owned attribution, and a referrer-restricted browser key. The old Amazon Location and MapLibre integration is removed.

The administrator route editor uses the Google Maps Routes library to compute a high-quality driving path through ordered stop pins. A computed road path is not automatically an operator-verified bus alignment: AC24 must still be checked against WBTC's published corridor and local route evidence. Keep `isApproximateGeometry` and `areStopsApproximate` true until that review is complete. Live tracking and ETA fusion continue to use the versioned route saved by the administrator, not a fresh external routing call on every poll.

Routine CI omits the browser key and verifies the honest text fallback. A configured browser smoke test is required before claiming Google tiles, traffic, markers, route computation, restrictions, or attribution work in production. Google Maps Platform usage and storage terms must be reviewed by the deployment owner before retaining generated path data.

Snapshot timers no longer define durability. Read-time projection computes current state; operational tasks such as log flushing and cleanup may use timers, but correctness and expiry must not depend on a background timer running on an idle container.

## Confirmed choices and remaining setup

| Item | Current decision or remaining setup |
| --- | --- |
| Product name (confirmed) | BusKothay |
| Route (confirmed) | AC24, Patuli → Howrah; exact geometry/checkpoints need verification |
| Operator/schedule source | None verified; show schedule only when sourced or explicitly illustrative |
| Git remote/team handles | User supplies; do not invent |
| AWS account, budget owner, final URLs | User/team supplies during cloud setup |
| Deployment claim | Only after actual HTTPS verification |

When changing a decision, record the reason and update every affected guide, schema, test, and environment example in the same change.

## 11. Existing implementation and verification boundaries

The implementation now exists in this repository. The original plan remains background; do not scaffold a replacement application. The current [implementation context](IMPLEMENTATION_CONTEXT.md) records inspected source/configuration gaps without waiving the requirements above.

Use `npm run build` for a local optimized preview and `npm run build:deploy` for deployment configuration validation. A local build passing does not establish valid cloud settings. Previous-session test reports remain historical until rerun, and memory-adapter tests do not establish DynamoDB behaviour. Documentation-only reviews must not mark infrastructure or acceptance gates complete.

## 12. Prototype-led interface and route administration

The supplied `buskothay-prototype final.html` is a visual and interaction reference, not an instruction document or a data authority. Its current design language supersedes the earlier amber, full-screen-map-only direction: Archivo type, cyan `#38D0FF`, near-black gridded canvas, compact Kolkata header, stop-first route finder, clean cards, restrained radii, light-theme option, and a desktop map/detail split. Real API states, accessibility, security, and honest provenance still take precedence over prototype placeholder data.

Route CRUD is no longer deferred. `/admin/routes` is protected by the existing server-owned administrator role and edits versioned route fixtures. The editor manages route identity, ordered draggable stop pins, generated road path, timetable, speeds/dwell, provenance, and verification flags. Cloud mode stores active overrides in DynamoDB; local memory mode resets on API restart. Publishing must create a new immutable route version so active journeys keep their original version.
