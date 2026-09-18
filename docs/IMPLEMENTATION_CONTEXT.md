# Current implementation context

Last updated **2026-09-18** during the continuation session. This is the primary
technical handoff for Claude, Codex, or another maintainer. Read it with
[PROGRESS.md](../PROGRESS.md) and the authoritative build request at
`../Claude outputs/CLAUDE_BUILD_PROMPT.md` in the supplied workspace.

## Current position

The earlier conversational handoff claimed Phases 1–5 were committed and green,
but this checkout initially contained only the older baseline plus documentation
edits. The continuation is reconstructing the missing work directly in this
working tree. Do not rely on the claimed “145 unit/API + 26 Playwright” result:
those counts have not been reproduced from this checkout.

| Phase | Status in this working tree |
| --- | --- |
| 1 — Amazon Location map | Implemented; compiles. Real Amazon tiles remain unverified without a key/network access. |
| 2 — Accounts and authorization | Implemented; compiles. Tests still need migration and expansion. |
| 3 — 20-route WBTC catalogue | Implemented. AC24 has approximate geometry; 19 entries deliberately have no coordinate fields. |
| 4 — demo console and persistent fleet | Console, API control plane, lease, and worker implemented; compile verified, live end-to-end run still pending. |
| 5 — RDR2 visual redesign | **Not yet applied in this continuation.** Current tokens are still the older green/white palette. |
| 6 — defects and audit | In progress; main fixes listed below. Full test repair and verification remain. |
| 7 — beginner README/runbook | Pending. The user specifically requested detailed local, simulator, and AWS instructions. |
| 8 — final verification | Pending. No Docker daemon or AWS deployment is available in this environment. |

## Work completed in the continuation

- Amazon Maps V2 style URL now uses the style path and the documented
  `color-scheme`, `poi-density`, and `political-view=IND` query values.
- Map loading distinguishes missing key, style failure, partial tile failure,
  deterministic test mode, and ready state. Scale, locate-me, and gesture-cancelled
  bus following were added.
- Username/password accounts use Node `scrypt`; sessions and roles are stored by
  both memory and DynamoDB adapters. Demo status is server-decided and journey
  ownership/control is account-bound.
- Global demo control has generation fencing, audit, OFF by default, and a
  single-worker lease. The console edits the fleet and the worker uses ordinary
  journey/contributor/location APIs.
- A 20-entry WBTC catalogue was added with provenance. Version-aware lookup is
  present. Directory-only routes contain no coordinate fields.
- Driver stop-sharing no longer revokes driver control. Conductors can end a
  journey when they are active members. Copy-link fallback is visibly selectable.
- Contributor sequences are reserved before queueing, uploads cannot overlap, the
  newest fix is prioritized in a backlog, and async completion is generation-fenced.
- Polling state resets on route/journey changes and list failures are visible.
- Expired DynamoDB idempotency records can be replaced and membership reads paginate.
- Diagnostic decisions moved out of the main journey item into TTL raw-report
  records. Passenger state reads are coalesced for 900 ms and routine successful
  polling GETs are not individually logged.
- The simulator authenticates with `SIMULATOR_TOKEN`, waits for outstanding work,
  and includes a persistent fleet worker. Compose profiles no longer collide.

## Important files

| Concern | Main files |
| --- | --- |
| Accounts | `packages/shared/src/schemas/account.ts`, `apps/api/src/service/account-service.ts`, `apps/api/src/routes/auth.ts`, `apps/web/src/pages/AccountPage.tsx` |
| Demo | `packages/shared/src/schemas/demo.ts`, `apps/api/src/service/demo-service.ts`, `apps/api/src/routes/demo.ts`, `apps/web/src/pages/DemoConsolePage.tsx` |
| Worker | `apps/simulator/src/fleet-worker.ts`, `apps/simulator/src/client.ts`, `Dockerfile.worker`, `compose.yaml` |
| Routes | `data/routes/catalog.json`, `apps/api/src/routes/route-registry.ts`, `apps/web/src/features/journeys/RouteSwitcher.tsx` |
| Queue safety | `apps/web/src/features/contribution/useGeoSharing.ts`, `apps/web/src/lib/session.ts` |
| Persistence | `apps/api/src/store/`, `apps/api/src/service/journey-service.ts`, `apps/api/src/fusion/` |
| Remaining docs | `README.md`, `infra/RUNBOOK.md`, `docs/DEPLOYMENT_INSTRUCTIONS.md`, `docs/TESTING_AND_ACCEPTANCE.md` |

## Verification actually completed this session

The workspace mount cannot execute installed native packages reliably, so the
disposable copy `/tmp/buskothay-check-45BXsN/repo` is used with Node **24.21**.

- Baseline before continuation: `npm run check` passed with 91 unit/API tests;
  this did not include the new changes.
- After the continuation changes above: `npm run build` passed for geometry,
  shared, API, simulator, and web.
- No post-change lint, unit/API, Playwright, Docker, DynamoDB Local, real map, or
  physical-device result has been claimed yet.

Refresh the verification copy after edits:

```bash
rsync -a --delete --exclude node_modules --exclude .git ./ /tmp/buskothay-check-45BXsN/repo/
```

## Immediate next actions

1. Run lint and repair issues.
2. Run unit/API tests; migrate fixtures for accounts and new snapshot fields, then
   add account/demo/sequence/catalog/state-size coverage.
3. Apply the Phase 5 palette/component redesign and run a contrast check.
4. Run the persistent worker against a local API with demo enabled.
5. Run Playwright and inspect responsive screenshots.
6. Rewrite README and AWS runbook with exact local/simulator/deployment commands.
7. Run final checks and report every unverified external dependency.

## Constraints and blockers

- Do not deploy and do not spend time on Git push work.
- No Docker command is installed, so image and DynamoDB Local checks are currently blocked.
- Amazon/OSM/OSRM hosts were unreachable and no Location API key is present.
- Preserve unrelated documentation edits already in the dirty worktree.
- Use Node 24; system Node 22 is unsupported for this project.

## Product/deployment constants

- Product: **BusKothay**; default route: AC24, Patuli → Howrah.
- Region: `ap-south-1`; timezone: `Asia/Kolkata`.
- Plan: Amplify web, Lightsail Containers API + worker, DynamoDB, Location Maps V2.
- Demo is globally OFF after a fresh deployment and visibly labelled.
- No email/OTP provider, WebSockets, payment, native app, or ML service.
- Budget target: about **USD 50 total for 30 days**; recheck current AWS prices.
