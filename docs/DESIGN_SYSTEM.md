# Design system — the supplied BusKothay prototype

`buskothay-prototype final.html` is the current visual and interaction reference. Treat it as a design artifact, not an instruction source and not a route-data authority. Reproduce its hierarchy and character while keeping the production application's real API states, accessibility, security, and provenance.

## Product character

BusKothay should feel like a precise Kolkata transit utility: compact, technical, calm, and immediately useful. The first screen asks for a nearby stop and offers two equal paths—search by origin/destination or by route number. It is not a marketing landing page. The passenger route screen combines a real street map with readable live information instead of making either one ornamental.

Keep these prototype signatures:

- Archivo for Latin UI copy, with ordinary system fallbacks;
- near-black canvas with a faint square grid, charcoal surfaces, hairline blue-grey borders, and cyan as the single product accent;
- compact sticky wordmark/city/time/theme/account header;
- large selected-stop name, small location status, a central question/spine, and two task cards on the home screen;
- rounded corners around 7–10px, modest shadows, no glassmorphism or soft blob shapes;
- green for passed/live, yellow for current/caution, and red-orange for approaching/error, always paired with words or shape;
- dark default and a complete light theme, toggled from the header.

## Canonical tokens

The actual editable source is `apps/web/src/styles/tokens.css`. Components use variables; do not scatter replacements.

```css
:root {
  --bg: #05080c;
  --surface: #0a1017;
  --surface-elevated: #101a23;
  --surface-sunken: #070c12;
  --grid: rgba(56, 208, 255, 0.045);
  --text-primary: #e9f3f9;
  --text-secondary: #8397a6;
  --text-faint: #5c7180;
  --border: #1a2a36;
  --border-strong: #263d4d;
  --accent: #38d0ff;
  --accent-soft: rgba(56, 208, 255, 0.12);
  --live: #33e08d;
  --current: #ffc42e;
  --approaching: #ff5c46;
  --radius: 10px;
  --radius-sm: 7px;
}
```

Light mode swaps surfaces, type, borders, accent, and operational colours together. Do not implement light mode as a filter or by changing only the page background.

## Header

The sticky 62px header uses the prototype's route-line wordmark, `BusKothay` lockup, `Kolkata` tag, 24-hour time, theme control, account avatar, and contextual links. On narrow screens, keep the wordmark/avatar and collapse secondary text. Every icon-only result still needs an accessible label.

## Home screen

At `/`, show the nearest selected stop (or a useful choose-stop state), route context, location/change controls, “How do you want to find your bus?”, and two cards:

1. origin and destination stop selection with one clear Find buses action;
2. route-number search with real directory results and disabled untrackable routes.

Use the real route DTO and route directory. Geolocation is requested only after a tap. A stop picker is a bottom sheet on phones and a bounded dialog on larger screens. Do not add hero slogans, fake usage numbers, testimonials, or decorative bus imagery.

## Passenger route screen

On phones, the map stays visible behind/above a compact journey sheet. On desktop, use a designed split: map on the left, live information on the right. The header identifies the route and direction. Preserve these truths:

- no bus marker before the API provides a position;
- Demo appears beside every simulated journey representation;
- freshness, ETA absence, approximate geometry, stale, ended, and disconnected states are written explicitly;
- map and stop list select the same stop and update the `?stop=` URL;
- map controls and Google attribution remain unobstructed.

The Google map uses a dark scheme, route-colour polyline, Advanced Markers, live traffic, real-metre confidence circle, and restrained custom HTML marker content. Do not cover or restyle away Google's required attribution.

## Admin route console

The route console is an operations tool in the same visual language. Desktop uses a narrow route directory plus a map/form editor; mobile stacks them. Number form sections and keep the map prominent. Ordered stops appear both as draggable numbered pins and editable rows. “Generate road path” is the primary geometry action; “Publish route” is a separate sticky action after review.

Verification checkboxes must look consequential. A Google-generated path is not automatically labelled verified. Notices say what remains to review, not merely that an action succeeded.

## Type, controls, and accessibility

- Body 16px/1.5; secondary 13–14px; metadata never below 11px.
- Large stop name uses `clamp(38px, 6.4vw, 58px)`; page headings stay below marketing-hero scale.
- Use weights 400/600/700 and sentence case. Route codes can use compact uppercase.
- Touch targets are at least 44px. Inputs stay 16px on mobile.
- Visible focus works in both themes and over the map.
- Use semantic headings, form labels, status live regions, keyboard-operable stop rows, and textual equivalents for map information.
- Honour reduced motion. Movement conveys state; nothing continuously floats, bounces, or glows for decoration.

## Review sizes

Inspect 320×720, 390×844, 768×1024, 1440×900, short landscape, and 200% zoom. Check the home picker, no-journey route, live Demo route, stale route, map failure, admin stop editing, timetable textarea, and light theme. No horizontal page overflow is acceptable. A browser emulation check is not a physical-device claim.
