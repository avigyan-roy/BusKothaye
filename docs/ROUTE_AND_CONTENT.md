# BusKothay route and content brief

## Confirmed by the user

- **Product name: BusKothay.** The user selected this name; do not ask them to choose again.
- **City/area: Kolkata and Howrah.**
- **Initial route: AC24, Patuli → Howrah.** Normalize the spelling to Howrah in the UI.
- Direction: outbound from Patuli for the first release. Do not silently add a reverse route by reversing coordinates; direction-specific roads and stop positions need separate verification.

Use `BusKothay` in the wordmark, browser title, manifest, README, and screen copy. Code/package slug: `buskothay`. Suggested descriptive line: “Know where your bus is.” Keep it small, and omit it from the map header if it crowds the useful content.

## Source-backed route identity

WBTC's published route list identifies **AC-24: Patuli to Howrah**, with the corridor **Ruby → Gariahat → Hazra → Exide → Park Street → Esplanade**. This confirms the requested route identity and major corridor, not a real-time operating schedule or every stop coordinate. [WBTC route list](https://wbtconline.in/home)

The separately listed **AC-24A** starts at Kamalgazi; do not mix its route name or origin into AC24. [WBTC route list](https://wbtconline.in/home)

Record the retrieval date as 2026-09-18 in the route fixture provenance, and recheck the route before presenting it as a deployed real-world service. Do not claim an official WBTC partnership or use its logo without permission.

## Initial selected checkpoints

Use these eight major checkpoints as the first-release route list:

1. Patuli
2. Ruby
3. Gariahat
4. Hazra
5. Exide
6. Park Street
7. Esplanade
8. Howrah

Label the list **Selected stops** or **Route checkpoints** until exact boarding locations and the complete stop list are verified. This is a deliberate subset for the prototype. The builder must verify coordinates, road access, and the correct terminal-side position at Howrah; no guessed coordinates should be presented as surveyed stops.

## Route-data deliverable

Create `data/routes/ac24-patuli-howrah.json` and a short adjacent provenance note. Include route code/name, immutable version, direction, timezone, road-following GeoJSON geometry, validated checkpoints, cumulative distances, authored segment speed assumptions, and source/license details.

Default route ID: `ac24-patuli-howrah`. Public path: `/r/ac24-patuli-howrah`. Timezone: `Asia/Kolkata`.

Generate geometry once using Amazon Location or another appropriately licensed source, with enough verified waypoints to preserve the actual corridor. Inspect the line on a street map; routing through only endpoints may choose a different route. Do not draw a straight line through the eight checkpoint coordinates and call it road-following.

If exact geometry is not verified yet, label the fixture **Approximate AC24 demo route** and disclose that in route details. A useful local demo may proceed while exact verification is pending; it must not pretend to be an official operational feed.

## Schedule and demo honesty

No departure timetable, fare, total duration, vehicle inventory, operator API access, or live WBTC feed has been supplied. Do not invent any of them. Arrival predictions come from the contributor/simulator journey and are labelled approximate. If no reliable timetable is added, schedule and delay fields remain null.

Real route identity and simulated vehicle data are separate: a demo can follow AC24 while still saying **Demo journey · simulated locations**. Public route labels must not imply that simulator output is a real WBTC bus.

## Copy and editability

Keep branding in `apps/web/src/config/site.ts`, UI strings in `apps/web/src/content/en.ts`, and route names/coordinates in the single JSON fixture. Components receive those values; they do not scatter “BusKothay”, “AC24”, or “Patuli” through JSX.

Previously considered names were Jatra, Cholo, RouteSignal, and NextStop. They are not alternate product names to show in the interface. Use BusKothay consistently.
