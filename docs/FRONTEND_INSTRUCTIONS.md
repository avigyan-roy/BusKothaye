# Frontend build instructions

Build the mobile experience first, using React, Vite, TypeScript, and the Google Maps JavaScript API. Follow [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) precisely and use [API_CONTRACT.md](API_CONTRACT.md) for every real interaction. Product name and route follow [ROUTE_AND_CONTENT.md](ROUTE_AND_CONTENT.md).

## Pages and navigation

| Page | Required result |
| --- | --- |
| `/` | Prototype-led stop-and-route finder using live route data; no marketing page |
| `/r/:routeId` | Passenger map, stop selection, arrivals, route context, tracking freshness |
| `/drive` | Start/join flow, consent, GPS sharing, source feedback, driver controls |
| `/ops/:journeyId` | Protected diagnostic view after a capability is provided |
| Unknown route/path | Useful not-found screen with a link to AC24 |
| `/admin/routes` | Administrator route, stop, path and timetable editor |

Use normal browser navigation and working back behaviour. Deep links must load directly after deployment. Keep API calls in `lib/api.ts`, route data in the server's route DTO, tokens in a small explicit session store, and copy in `content/en.ts`.

Avoid a large component framework. Use plain CSS/CSS modules plus shared design tokens, a small consistent icon set, and semantic elements. Icons always have a visible label or an accessible name. Do not add a button because it fills empty space.

## Passenger map: real integration

1. Fetch route geometry and active journeys. Load Google Maps with `@googlemaps/js-api-loader` only when a map surface mounts; keep a nonzero responsive container height.
2. Use a public browser key restricted by exact HTTPS referrers and only the required Maps JavaScript/Routes services. The key is public by design but it is still never hard-coded or logged.
3. Draw the versioned route LineString with a Google polyline and stops/bus/user positions with Advanced Markers. Select a stop from either the list or map; update both representations together.
4. Fit the route bounds once with padding for the real layout. Do not refit on every poll or fight the user when they pan. Provide a working “Show route”/recenter control.
5. Add a bus marker only when position exists. Show no invented bus when `PENDING` or when the route has no active journey.
6. Poll the selected journey about once per second. Use one in-flight request at a time, an abort controller, timeout, and backoff on errors. Pause when hidden and refetch when visible.
7. Use shared bounded projection between responses. Never advance the marker forever after a network failure.
8. Keep Google's logo, terms, and attribution UI visible and unobstructed. Use `ResizeObserver` when the layout changes. Dispose of overlays, markers, and listeners on unmount and avoid duplicate construction in React development mode.

A credential-free test build shows an honest fallback rather than loading a second provider. A fully verified release requires actual Google tiles, route alignment, readable labels, provider attribution, traffic, and key restrictions. A blank map is an error state, not an acceptable finished feature.

Handle loader/tile failures with an inline explanation and Retry. Retain the textual stop/arrival view if the provider is unavailable. Do not silently change providers and mislabel the source.

## Route editor

The admin editor uses ordered stop pins as waypoints. Pins are draggable, map click can add a stop, and manual latitude/longitude fields remain available for precise correction. “Generate road path” is an explicit operator action because it calls Google's billable Routes library. Use high-quality driving geometry through the stops without reordering them. Show distance and a review warning, then let the administrator mark the line and boarding points verified independently.

Publishing creates a new version through `PUT /v1/admin/routes/:routeId`; never mutate only frontend state or write route JSON from the browser. Edit identity, direction, route colour, timezone, typical speed, dwell, source, departures, and provenance. Preserve honest `illustrative` and `approximate` flags. The editor must remain usable on a narrow phone, but its desktop map/form workspace is intentionally denser than the passenger screen.

## State and time on the browser

Use `serverTs` from the response plus monotonic elapsed time since receipt, with a bounded network-latency estimate if used. Do not subtract the device wall clock from server time. Ignore responses older than the current state version; for equal versions use server timestamp ordering.

The shared projection function accepts the confirmed anchor, not an already projected coordinate. Enforce the supplied stop/distance cap and stale deadline. Switch freshness presentation locally as time elapses without a poll. Keep `lastConfirmedPosition` distinct from the last displayed estimate.

Do not continue showing a green “Live” badge while the API is unreachable. A small “Reconnecting” indicator may coexist with the appropriate estimated/stale mode. At expiry/end, freeze the marker and show no active arrival claim.

Display `confidenceM` as a map-scale approximate area generated in geographic metres, not a CSS circle with fixed pixels. Treat it as indicative uncertainty; do not label it a guaranteed probability. During correction animate along the route with reduced-motion support.

If multiple journeys exist, provide a compact accessible selector and show one selected journey in the first release. Prefer a real journey over a demo only through an explicit documented selection rule, never by hiding its identity. All demo summaries and detail views show “Demo”.

## Passenger information

- Route badge `AC24`, direction “Patuli → Howrah”, chosen stop, arrival range, remaining route distance, and freshness.
- Stop rows are selected route checkpoints, not an exhaustive official-stop claim. Show that distinction in route details.
- Use “Choose your stop”; selecting a stop updates the map and arrival panel. Store only this non-sensitive preference locally.
- Put the stop ID in a shareable `?stop=` link. Do not put capabilities in public links.
- GPS permission is not required to view buses. A passenger “Locate me” feature is optional and must request permission only after tapping it.
- Delay appears only if the API has a real schedule basis. Missing schedule is “Schedule unavailable”, not “On time”.
- Null ETA, no buses, ended journeys, and unavailable route data must have useful text rather than blank cards.

## Contributor page

Start with two simple actions, “Start a journey” and “Join a journey”. The only available route is preselected and labelled. Explain that this is community sharing and is not an official operator feed.

Creating a journey shows join code, copy code, copy join link, open passenger view, and driver controls. Capabilities stay outside URLs. Joining requires journey ID from the link or pasted link plus the join code; accept only passenger/conductor roles.

Before starting GPS, show: “Your location will help estimate this bus journey. Keep this screen open while sharing. You can stop at any time.” Include a short link/expandable note on raw-report retention. Sharing requires an explicit click; never start from merely opening `/drive`.

Use `watchPosition` with high accuracy, `maximumAge:0`, and an error handler. Capture a monotonic receipt time for each fix so `sampleAgeMs` can be recomputed before sending. Browser location accuracy/speed may be absent or poor; do not crash or claim sharing succeeded before the server accepts a fix.

Flush about every three seconds, cap the in-memory queue at 200, and send batches of at most 60. When reconnecting with a large backlog, send a fresh/latest batch first and older data as history; old reports cannot drag current state backwards. Preserve unsent data on transient errors; do not retry ordinary `accepted:false` responses forever. Respect `Retry-After`.

Request screen wake lock only while sharing and supported; reacquire on visibility change. If denied, continue with clear guidance. A locked/suspended phone may produce no fixes, so buffering cannot recover positions that were never captured. Do not promise background web tracking.

Show sharing status, last server decision, queued count when offline, an understandable rejection reason, and a clear Stop/Pause action. On stop, clear the watcher, release wake lock, cancel timers, and discard unsent private reports. Revoke passenger/conductor membership when possible; never resume uploading after stop because a delayed retry completed.

Keep contributor tokens in memory/session storage, not local storage. Restore controls after reload if the session is valid, but ask the person to explicitly resume GPS. Persist the next sequence counter with the session. Clear credentials after revoke/end/expiry. Render all server text safely; no raw HTML.

## Diagnostics

The ops page initially requests the journey-specific ops token unless the current session owns a valid driver token. Store it only for the session and send it in the authorization header. An unauthenticated request must never reveal source locations.

Show source role/pseudonym, age, accuracy, projected distance, bounded weight, reputation, and latest decision. Add fused state, correction events, and storage status. Poll at a slower 1–2 second cadence and bound visible rows. Use a responsive list on phones and a table on desktop; avoid a wide clipped table.

## Accessibility and performance

Use semantic headings, labels, buttons, keyboard navigation, visible focus, readable contrast, minimum 44px targets, and 16px input text. The map must have a equivalent textual stop/arrival view. Announce important state transitions through a polite live region; do not announce every second or every coordinate change.

Lazy-load map/ops code if it materially reduces initial work. Do not re-render the entire app each animation frame. Animate only the marker via map APIs and use React state for UI data at the polling cadence. No autoplay, decorative particle effects, unnecessary web fonts, or giant image assets.

## Verification before handoff

Inspect the live API-connected app at mobile, tablet, and desktop sizes. Test map stop selection, join code copy, keyboard access, denied GPS, network loss, stale timeout, and direct URL refresh. Use a real phone when available; otherwise state clearly that physical-device testing remains outstanding. A browser emulation check is not proof of background phone behaviour.
