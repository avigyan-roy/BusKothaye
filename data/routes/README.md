# AC24 route fixture provenance

The canonical fixture is [ac24-patuli-howrah.json](ac24-patuli-howrah.json), version `2026-09-18-approx-1`. All applications use the API's prepared form of this file. Do not copy it into frontend or simulator source.

## What is known and what is approximate

- Identity: AC24, Patuli → Howrah, outbound, timezone `Asia/Kolkata`.
- The fixture records WBTC's published route list as the route-identity source, with retrieval date 2026-09-18. That source was not re-fetched during the documentation review.
- Eight selected checkpoints: Patuli, Ruby, Gariahat, Hazra, Exide, Park Street, Esplanade, Howrah. They are not a verified complete list of boarding stops.
- Geometry and checkpoint coordinates are hand-authored approximations. Both `isApproximateGeometry` and `areStopsApproximate` are true. The Howrah coordinate is not a verified AC24 boarding bay.
- `verifiedOn` must be read alongside those flags and provenance notes; it is not evidence of a road survey or geometry verification.
- The fixture records geometry as original work, not a provider trace. That provenance statement does not establish a project-wide distribution license; `package.json` currently says `UNLICENSED`.
- `schedule` is null. Segment speeds and dwell values are authored estimation assumptions, not an operator timetable or measured live traffic.

## Replacing the approximation

1. Resolve the immutable-route-version gap in [implementation context](../../docs/IMPLEMENTATION_CONTEXT.md) before changing geometry used by retained journeys.
2. Use `scripts/fetch-route-geometry.mjs` with a supported provider, or prepare a licensed trace with sufficient waypoints to follow the intended corridor.
3. Inspect roads, direction, carriageway, checkpoint positions, and terminal bay. A routing response alone does not verify the bus's actual route.
4. Update version, source URL, license/attribution, verification date and notes. Set each approximation flag false only after that aspect has actually been checked.
5. Run `npm run routes:validate` and affected tests/scenarios, then inspect alignment on the intended street basemap. The validator checks internal geometry consistency, not real-world operation.

See [ROUTE_AND_CONTENT.md](../../docs/ROUTE_AND_CONTENT.md) for the product requirements. Never add an invented timetable, fare, fleet count, or official operator affiliation.
