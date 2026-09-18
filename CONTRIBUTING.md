# Working on BusKothay with the team

Four people should be able to clone this, change something, and push it without
asking anyone how the project works.

Run application commands from this repository root. Read [implementation context](docs/IMPLEMENTATION_CONTEXT.md) for known gaps.

## First setup

1. Install the Node version in `.nvmrc` (24) and npm 10.9 or newer.
2. Clone your team's own remote. Never copy someone else's `node_modules` or
   `.env` — one is large and machine-specific, the other is theirs.
3. From the repository root:

   ```bash
   npm ci
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env.local
   ```

   On Windows, `Copy-Item apps\api\.env.example apps\api\.env` and likewise for
   the web file, or just copy them in the file manager.
4. `npm run dev`, then in a second terminal
   `npm run simulate -- --scenario happy-multi --api http://localhost:3001`.
5. `npm run check` once, before you change anything, so you know what a working
   baseline looks like on your machine.

For the browser tests, once per machine: `npx playwright install --with-deps chromium`.

Commit `package-lock.json`. Never commit `node_modules`, `.env` files with real
values, build output, editor caches, or real contributor location traces. The
`.env.example` files hold placeholders and defaults that are safe to share.

## Branches and pull requests

Keep `main` working. Short branches, named for what they do:
`feat/passenger-map`, `feat/journey-api`, `fix/stale-marker`, `docs/local-setup`.

```bash
git switch main
git pull --ff-only
git switch -c feat/passenger-map
# … work …
git push -u origin feat/passenger-map
```

Make focused changes, run the checks that match them, and read your own diff
before staging. Stage the files you meant to change, not a whole directory that
might contain something private.

In the pull request, say what changed, why, which checks you ran, and anything
about the environment or the schema that someone else has to know. Add
mobile and desktop screenshots for a meaningful layout change, and simulator
results for a fusion change. Never paste a screenshot or a test result you did
not produce.

### Which checks for which change

| You changed | Run |
| --- | --- |
| Copy, spacing, colours | `npm run lint`, and look at the screen at 390 px and 1440 px |
| A component or a page | the above, plus `npm run test:e2e` |
| Anything in `packages/shared/` | `npm test` and update every consumer in the same PR |
| `apps/api/src/fusion/` | `npm test`, plus the simulator scenarios that cover it |
| `apps/api/src/store/` or `auth/` | `npm test`, and think about restart, concurrency and expiry |
| `data/routes/` | `npm run routes:validate`, bump `version`, re-run a scenario |
| `Dockerfile`, `infra/`, `amplify.yml` | build the image; follow `infra/RUNBOOK.md` |

`npm run check` runs lint, types, route validation, tests and a production build.
It is what CI runs, minus the browser and container jobs.

## Who owns what

| Area | Suggested owner | Coordinate before changing |
| --- | --- | --- |
| Backend and fusion (`apps/api/`) | Member 1 | Shared schemas, and the timing and geometry constants |
| Frontend and visual design (`apps/web/`) | Member 2 | API changes, and `styles/tokens.css` |
| Simulator and regression scenarios (`apps/simulator/`) | Member 3 | New event or rejection semantics |
| AWS, integration and docs (`infra/`, `Dockerfile`, `docs/`) | Member 4 | Environment variable names, release timing, runtime versions |

These are roles, not GitHub usernames. Add a `CODEOWNERS` file once you have real
handles — not before, and nobody should invent one. Ownership is there to reduce
collisions; everyone may read and edit everything.

## Files that need coordination

- **`packages/shared/`** — one contract for three consumers. Change the schema
  and every consumer and its tests in the same pull request. Two branches
  inventing different shapes for the same endpoint is the expensive failure here.
- **`packages/shared/src/constants.ts`** — a threshold change moves the server,
  the browser and the simulator's expectations at once. Bring test evidence.
- **Root `package.json` and the lockfile** — agree on new dependencies. Resolve a
  lockfile conflict with npm and verify `npm ci` afterwards; never hand-edit it.
- **`data/routes/`** — bump `version` whenever geometry or stop distances change.
  Journeys already running keep the version they started with.
- **`apps/web/src/styles/tokens.css`** — the one place for palette and spacing.
  A component-level override quietly forks the design system.
- **Deployment settings** — share variable *names*. Never a value that is secret,
  and never in a chat message or a commit.

## Manual edits and working alongside an AI

Everything here is ordinary source in an ordinary editor. No generator, no
low-code export, no agent-specific runtime is needed to change anything.

If you hand the project to an AI, tell it what you changed by hand and what must
be preserved, and require it to read the current files rather than trusting its
own earlier output. It must not reformat unrelated files or regenerate whole
folders over someone else's work. `docs/MANUAL_EDITING.md` names the file for
almost any change you might want.

When two people edit the same area, read both versions and agree on the
behaviour. No blanket "ours"/"theirs", no `reset --hard`, no force push to make a
conflict disappear. Re-run the affected checks after the merge.

## Pull-request checklist

- [ ] Only the files you meant to change; teammates' manual edits preserved.
- [ ] No secrets, no real contributor traces, no machine-specific absolute paths.
- [ ] The right checks ran, and anything that failed is disclosed rather than
      quietly excluded.
- [ ] Mobile and desktop both looked at, if the UI changed.
- [ ] Shared contracts, `.env.example` files and docs updated together.
- [ ] No unfinished visible controls, and no hidden production fixtures.
- [ ] Deployment impact noted — and no API rollout while someone is recording.
