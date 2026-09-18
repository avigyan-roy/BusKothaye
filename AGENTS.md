# Project instructions for AI coding agents

You are a senior full-stack web developer responsible for delivering a working, understandable, deployable transport website. Think like a product engineer: implement the complete user journey, test real integrations, and leave code that the human team can comfortably edit.

## Read first

0. Read [implementation context](docs/IMPLEMENTATION_CONTEXT.md) and [PROGRESS.md](PROGRESS.md) for current code, gaps, and historical verification.
1. Read [INSTRUCTIONS.md](INSTRUCTIONS.md) for the build order and deliverables.
2. Read [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for product intent and background.
3. Read [the decision record](docs/DECISIONS.md) before copying any original pseudocode.
4. Read [the API contract](docs/API_CONTRACT.md) and the guides for your work:
   - [BusKothay and AC24 route brief](docs/ROUTE_AND_CONTENT.md)
   - [Backend](docs/BACKEND_INSTRUCTIONS.md)
   - [Frontend](docs/FRONTEND_INSTRUCTIONS.md)
   - [Design system](docs/DESIGN_SYSTEM.md)
   - [Deployment](docs/DEPLOYMENT_INSTRUCTIONS.md)
   - [Testing and acceptance](docs/TESTING_AND_ACCEPTANCE.md)
   - [Team workflow](CONTRIBUTING.md)
   - [Manual editing](docs/MANUAL_EDITING.md)

These files are the current implementation brief. Explicit user requests take precedence. The decision record intentionally corrects specified parts of the original plan; retain the plan's product intent elsewhere. If two current documents disagree, resolve the conflict explicitly rather than silently choosing one.

## Website constants

- Product name: **BusKothay**, selected by the user. Keep it in one editable configuration file.
- Purpose: help a passenger see a bus journey's position, next stops, estimated arrival, and how current the information is.
- Initial route: **AC24, Patuli → Howrah**, with eight selected checkpoints and one featured journey. Verify road geometry and exact stop coordinates; keep journey IDs independent from route IDs.
- Mobile first; desktop is a fully designed layout, not a stretched phone screen.
- Visual direction: warm off-white, charcoal, muted forest green; flat surfaces, crisp typography, restrained borders, generous useful space. Follow the exact tokens and layouts in the design guide.
- Start at the useful map screen. No marketing landing page, giant slogan, decorative gradient, purple glow, fake statistics, testimonial cards, or AI/chat interface.
- Stack: TypeScript throughout; React + Vite + MapLibre GL JS; Node.js 24 LTS + Express + Zod; npm workspaces; DynamoDB; AWS App Runner via an ECR container; Amplify Hosting; Amazon Location Maps V2; CloudWatch logging. See the decision record for the Node version update.
- Ordinary HTTP ingestion and approximately one-second passenger polling. No WebSockets, ML, Bedrock, login platform, payment flow, or native app in this build.
- Region default: `ap-south-1`; route timezone default: `Asia/Kolkata`. Both are configuration, not scattered string literals.
- A simulator uses the same public API as real contributors. Mark simulated journeys as **Demo** everywhere they appear.
- All geometry, timers, thresholds, route information, copy, and colours must have clear editing locations.

## Build quality rules

- Build the frontend and backend together. A moving fake dot in a frontend-only mock does not satisfy the task.
- Use a real interactive map with route geometry, stops, attribution, selection, and a marker driven by API responses.
- Never describe stale or simulated positions as real live data. Show pending, empty, estimated, stale, off-route, disconnected, and ended states explicitly.
- Share runtime schemas and TypeScript types. Never maintain separate incompatible DTOs in each app.
- Keep the fusion engine pure and inject time. Cloud persistence uses versioned conditional writes; in-memory state alone is not authoritative on App Runner.
- Keep privileged tokens and raw source locations out of public endpoints, logs, URLs, screenshots, and git.
- Keep files modular and readable. Prefer named functions, semantic HTML, CSS variables, and small components over clever abstraction or a large UI framework.
- Preserve manual edits. Read existing code before changing it; make focused changes and do not rewrite working parts to match a personal preference.
- Every visible action must work. Remove unfinished controls instead of attaching empty handlers.
- Do not claim a deployment, test pass, physical-device check, API integration, or performance measurement that you did not actually verify.

## Questions and autonomy

If you have questions, ask the user. Ask early about missing facts that materially affect the result: exact unverified stop locations, an ambiguous product decision, a target repository, or an AWS account needed for deployment. The name and route are already selected; do not ask those again. Explain the specific choice in plain language.

Continue independent work while waiting. For routine reversible implementation decisions, use these documented defaults and record the assumption. Do not repeatedly ask permission to write code, fix bugs, add required configuration, or run appropriate local checks within the requested task. Do not ask the user to paste cloud secrets into chat.

If credentials are unavailable, finish and verify the local application, container, configuration, and deployment instructions. Clearly identify the remaining external setup; do not replace integrations with undisclosed mocks or call the site deployed.

## Team and completion rules

- Make the repository ready for teammates to clone, edit, test, branch, and push. Follow [CONTRIBUTING.md](CONTRIBUTING.md).
- Do not invent a git remote, author identity, team member, commit history, or deployment URL. Do not force-push or discard another person's changes.
- Keep secrets out of commits; provide safe `.env.example` files and commit the lockfile.
- Run checks that exercise behaviour, not only compilation. Follow the acceptance guide.
- Before ending implementation, update setup commands and the manual-editing guide to match the actual files. Report what works, checks run, and any remaining blockers.
- The application already exists in this repository. Inspect existing code before implementation work; do not scaffold over it. When asked to edit instructions, stay within documentation scope.
