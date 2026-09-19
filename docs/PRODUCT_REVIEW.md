# Product review for the next BusKothay release

Reviewed 2026-09-18. Historical review only: its MapLibre/Amazon, account, catalogue, and demo findings describe the pre-migration checkout and are superseded where the 2026-09-19 decision record or current source differs. Keep still-relevant defect ideas, but do not use this file as the current provider or design brief.

## Confirmed product gaps

| Finding | Evidence | Required change |
| --- | --- | --- |
| Default map lacks useful Kolkata street detail | `apps/web/src/features/map/mapStyle.ts` uses the MapLibre demonstration style. `localStyle.ts` has only a background layer; `MapView.tsx` switches to it on recognized map failures. | Integrate and verify a licensed street basemap, including labels, bridges, parks, tiles, glyphs and sprites. Distinguish provider failure from a successful street map. Diagnose the actual user's failure in-browser before claiming its exact cause. |
| Demo ends after a minute | `apps/simulator/scenarios/happy-multi.json` sets `durationS: 60`; the runner ends its journey. | Keep regression scenarios, add a configurable interactive demo console with long runs and explicit lifecycle controls. |
| Simulator settings exist only as fixtures/CLI | `scenario.ts` supports route, start distance, speed phases and sources; `cli.ts` has no interactive map or runtime controls. | Reuse these foundations for route/start-point/speed/fleet controls; do not merely extend the timeout. |
| No user or staff account login | `App.tsx` has passenger, drive and ops routes only. `auth/capabilities.ts` explicitly implements capabilities without accounts. | Add real authentication, persisted role assignment, authorization and distinct passenger/staff entry flows. |
| Conductor is currently a label without an account | `DrivePage.tsx` offers passenger/conductor radio buttons; creating a journey grants driver control. | Per the updated user decision, keep freely selected demo roles but persist authenticated accounts and enforce journey ownership/membership on the backend. No staff approval required. |
| Existing console is partial for the new requirements | `/drive` provides start/join, GPS consent, copy controls, pause/stop and driver end. | Retain working flows; add route/bus assignment, role-aware dashboard, account recovery and proper lifecycle handling. Not yet a verified staff console. |
| AC24 is the only fixture and creation default | `data/routes/` has one route JSON; `DrivePage.tsx` creates `site.defaultRouteId`. | Add a real multi-route catalogue, search, selection and version-aware route data. |
| Tests do not establish the required map/cloud behaviour | Playwright uses `VITE_MAP_PROVIDER=none`; API test helper constructs memory storage. | Add real-provider smoke verification and DynamoDB integration tests; preserve deterministic offline map tests for routine CI. |

## Source-level defects and risks to reproduce and fix

| Priority | Evidence and consequence | Regression to add |
| --- | --- | --- |
| High | `DrivePage.tsx` exposes Stop sharing to the driver; `leave()` calls `sharing.stop(true)` and clears the session. This can revoke the driver's only control capability. | Driver pauses GPS and can still end the journey; passenger/conductor leave only revokes their own membership. Define deliberate transfer/end separately. |
| High | `useGeoSharing.ts` has no in-flight guard for `flush()`, invoked by interval and visibility changes. Each response removes `batch.length` items from the current queue. | Delay two overlapping uploads: acknowledgements cannot remove newly queued, unacknowledged fixes or apply stale responses. |
| High | The same hook selects the oldest 60 fixes first. On reconnect, fresh reports may wait behind stale backlog, contrary to the frontend brief. | Backlog near the 200-fix cap: newest eligible fix reaches the server promptly, history cannot move live state backward. |
| High | A boolean `activeRef` guards late callbacks but does not identify a sharing generation. Stopping and quickly restarting can make an old response appear current. Wake-lock acquisition can also resolve after stop. | Stop/restart or switch sessions during an upload/permission/wake-lock request; old work cannot restore sessions, remove new queue entries, or retain a lock. |
| High | `start()` is not idempotent, and the Start button remains available while GPS is requesting or after some errors. Repeated clicks can overwrite stored watcher/timer IDs. | Repeated start/retry yields exactly one watcher/timer, all capture stops on leave/unmount. |
| Medium | Sequence persistence is advanced after acknowledgement. A server commit with a lost response followed by reload can reuse sequence numbers. | Persist safe sequence allocation before sending, validate session state at runtime, test reload after lost acknowledgements. |
| Medium | Clipboard fallback looks for `copy-link`, but that element is absent; it still reports Copied after Clipboard API failure. | Deny clipboard access: show a selectable full link and accurate feedback. |
| Medium | `useActiveJourneys.ts` retains old journeys when route ID changes and swallows fetch errors. `useJourneyState.ts` does not reset all error/reconnect flags when switching journeys. | Switch routes/journeys during slow or failing requests: no old-route bus or misleading empty/success state. |
| High | Route snapshots record versions, but `RouteRegistry` and service lookup select by route ID. | Retained journeys use their original geometry across route-file updates and deploys. |
| High | DynamoDB idempotency reads ignore expired records, but replacement uses `attribute_not_exists(PK)`; expired records awaiting TTL deletion can block key reuse. | Test expiry before physical deletion, with concurrent create/join attempts. |
| High | DynamoDB route membership queries stop after the first page (`Limit: 100`). | Active journeys behind expired membership rows remain discoverable through pagination. |
| Medium | Map failure detection can replace the entire style on an individual resource error; style reload discards overlays and selected-state layers. | Partial tile errors, retry, style replacement, selected stop and moving bus all recover without permanent blank basemap or lost overlays. |
| Medium | Simulator sends requests without awaiting each one and uses a fixed 1.2-second settling delay before final diagnostics. | Slow network: await tracked in-flight work with bounded timeouts and cleanup; no late writes after end or incomplete final scorecards. |
| Medium | No active CI file is in the app repository. The exported workflow's E2E job lacks the API/shared build. Compose profile selection can start two APIs on port 3001. | Clean checkout CI/E2E and both documented container setups actually run. |

Also audit fusion/ETA correctness, route direction, authorization races, raw-data retention, session expiry, XSS/CSRF as applicable to chosen auth, multi-journey isolation, map-resource permissions, service readiness, resource limits and responsive accessibility. Fix independently discovered defects; do not limit the work to this table.

## Official route research

Source checked 2026-09-18: [WBTC published route list](https://wbtconline.in/home). These are catalogue candidates, not confirmation of current operations or surveyed geometry. Preserve raw source spellings in provenance; use reviewed display names separately.

| Code | Listed origin → destination |
| --- | --- |
| AC9 | Jadavpore → Karunamoyee |
| AC9B | Jadavpore → Eco Space |
| AC12 | New Town (Sapoorji) → Howrah |
| AC12D | Joka → Howrah |
| AC14 | Baruipur New Terminus → Karunamoyee |
| AC20 | Santragachi → Barrackpore |
| AC23A | Salt Lake Depot Gate → Rajchandrapur |
| AC24 | Patuli → Howrah |
| AC24A | Kamalgazi → Howrah Station |
| AC30 | Lake Town (Jaya Cinema) → Howrah Station |
| AC30S | Ultadanga → Sapoorji |
| AC31 | Behala Chowrastha → Jadavpur |
| AC37 | Garia → Barasat |
| AC37A | Garia → Airport |
| AC38 | Dum Dum 11A Stand → Karunamoyee |
| AC39 | Howrah → Airport |
| AC40 | Airport Gate 1 → Howrah Maidan |
| AC43 | Golf Green → Airport |
| AC47 | Kundghat → Sapoorji |
| AC50A | Garia → Rajchandrapur |

**AC58, ACT26, ACT38 remain unresolved in the official sources checked.** Do not substitute AC38, C26, or another route merely because the number resembles the requested one. Continue targeted official research and ask the user for endpoints or a source if needed. The `wbtc.co.in/bus-service/` page could not be retrieved in this review; that is not evidence those routes do not exist. Secondary reports are discovery leads, not verified route fixtures.

For every enabled route, verify actual corridor, direction and geometry separately. Missing coordinates must be explicit gaps; do not manufacture 20 route lines or timetables to satisfy a count.

## Relevant technical sources

- [Amazon Location map styles](https://docs.aws.amazon.com/location/latest/developerguide/map-styles.html): Standard and Monochrome provide real geographic context and can serve as the starting point for a restrained custom map appearance.
- [Styling dynamic maps](https://docs.aws.amazon.com/location/latest/developerguide/styling-dynamic-maps.html): verify supported style parameters instead of guessing descriptor query keys.
- [Cognito user-pool groups](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-user-groups.html): a candidate managed identity foundation; application permissions still need server enforcement.

## Confirmed user choices — supersede earlier proposals

- Basic username/password self-registration, no email/phone verification and no staff approval. Anyone can select passenger, driver or conductor for the casual demo. Accounts and server authorization must actually work.
- Real-phone driver reporting must work locally and on AWS, reaching passenger views through the real backend. Synthetic data is produced by a separate script/worker using the same ingestion API.
- Stronger RDR2 appearance: parchment, charcoal, dark red, western headings; retain readable real street maps.
- Shared public simulated fleet runs continuously while ON, even with browsers closed. Any logged-in account can control the global switch. OFF fully stops synthetic reporting/active demo journeys while preserving real-phone testing. Demo-source labelling and unverified community-role labelling are separate.
- Prefer useful AWS services within **US$50 total for 30 days of demo/testing**. Calculate continuously enabled fleet costs for the full period; record deployment start and automatic stop/teardown dates before enabling billed resources.

Outstanding product details: fleet/viewer capacity, conductor start/end authority, unresolved route endpoints and actual deployment access. Proposed defaults: guest map access, small bounded configurable fleet, conductor join/share only, Amazon Location. Do not re-ask settled choices or apply the former admin-approved-staff requirement.

The authoritative requested implementation scope is the workspace's `CLAUDE_BUILD_PROMPT.md`; this review remains source evidence, not a claim that the requested changes are implemented.
