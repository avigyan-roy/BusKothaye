# Design direction — a quiet Kolkata transit utility

Build a clear, practical transport interface with a local identity. The visual reference is a well-designed transit information board: route number, destination, arrival, and evidence. The map is useful working space. The interface should feel intentionally designed rather than assembled from a generic startup template.

## Palette: use these tokens

Put these in `apps/web/src/styles/tokens.css`; components reference variables rather than repeating hex codes.

```css
:root {
  --color-canvas: #F5F4EF;
  --color-surface: #FFFFFF;
  --color-ink: #202923;
  --color-muted: #59635C;
  --color-border: #D8DED6;
  --color-accent: #285C45;
  --color-accent-hover: #1D4935;
  --color-accent-soft: #E7EEE6;
  --color-warning: #85540E;
  --color-warning-soft: #FFF0D6;
  --color-danger: #A33333;
  --color-danger-soft: #FBEAEA;
  --color-focus: #245F87;
  --radius-control: 8px;
  --radius-panel: 12px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
}
```

The map route uses accent green with a thin white casing for contrast over roads. Green is also a selected/control colour, so tracking states need an icon and text, not colour alone. Muted text stays readable; avoid pale grey microcopy. Verify text contrast and keyboard focus on the implemented screens.

White buttons on the green primary background; ink on light surfaces. Warning and danger colours appear only when their meaning applies. Do not tint the entire app with the warning colour during an outage.

## Typography

- Use one system sans-serif stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Body: 16px, line height 1.5. Secondary text: 14px. Metadata: minimum 12px; never put a primary action or ETA qualification at that size.
- Destination/page heading: 24px on mobile, 30–32px on desktop; weight 600.
- ETA: 32px mobile / 36px desktop, weight 600, tabular numerals. The unit `min` is smaller and regular weight.
- Route code `AC24`: 14–16px, weight 700, compact rectangular badge, small corner radius. This is the strongest branding element after the wordmark.
- Use sentence case. Avoid wide letter spacing and uppercase labels everywhere.
- Bengali support may be added later through the copy dictionary; do not add a nonfunctional language switch.

## Mobile layout: 360–767px

Design at 390px first, then verify 360px and 320px. Use `100dvh` and safe-area padding, with usable scrolling on short screens and at 200% zoom.

```text
┌─────────────────────────────┐
│ Wordmark          Share GPS │  compact header, about 56px
│ AC24  Patuli → Howrah       │  route identity and direction
│                             │
│           MAP               │  real interactive map
│        route · bus · stops   │  about 40–48dvh on a normal phone
│                   [recenter]│  44px controls, above attribution
│                      credits│
├─────────────────────────────┤
│ Selected stop        [change]│
│ 6–9 min                     │  only when real API data supports it
│ Live · confirmed 3 sec ago   │
│                             │
│ ○ Next stop           2 min │  flat list with separators
│ ○ Selected stop     6–9 min  │
│ ○ Following stop   9–12 min  │
└─────────────────────────────┘
```

The information panel follows the map in document flow. It may visually meet the map edge with rounded top corners, but do not require dragging a bottom sheet to access primary content. Keep scrolling and map gestures distinct. On very short screens, use a smaller map and ordinary page scroll rather than hiding controls.

No desktop sidebar collapsed into an unlabeled icon maze. No unnecessary bottom navigation for a three-screen utility. A persistent text link to sharing and a clear return link are sufficient.

## Tablet and desktop

- 768–1023px: split information and map when space permits, roughly 320px for the stop panel; otherwise use the mobile flow. Do not make 768px a hard usability cliff.
- 1024px and above: header about 64px high; content maximum width around 1440px; stop/ETA panel 360–400px on the left and map filling the remainder.
- Use a subtle vertical divider, not separate floating cards for every datum.
- Desktop map can occupy the remaining viewport height. The stop panel scrolls accessibly when needed.
- Reflow cleanly for landscape phones, long stop names, and browser zoom. Never crop the map attribution.

## Components

**Header:** plain wordmark, route context, and one useful navigation action. No large logo illustration or oversized navbar.

**Arrival panel:** selected stop name, arrival range, distance, freshness. If unavailable, replace the number with a concise message; do not leave a seductive false number underneath an error overlay.

**Stop row:** small route-line marker, stop name, one secondary distance/status line, arrival aligned right. At least 52px tall; keyboard selectable. Selected row uses the soft green background and a visible label, not a huge shadow.

**Buttons:** minimum 44×44px touch area; primary green, secondary outlined or text. One main action per panel. Destructive end action has a confirmation dialog; ordinary stop-sharing is immediate.

**Forms:** labels above inputs, 16px input text, inline errors, clear pending state. Join code accepts typing/paste and normalizes harmless spacing/case.

**Status:** compact icon + text. `LIVE` solid marker; `ESTIMATED` hollow marker + scaled uncertainty area; `STALE` faded static marker. Off-route adds a concise warning and suppresses ETA.

**Ops:** same typography and palette, dense readable table on desktop, stacked source rows on mobile. It is a diagnostic screen, not a separate neon dashboard.

## Motion and map styling

- Use a light, restrained street map. No tilted 3D buildings, spinning globe, satellite default, animated background, or huge pulsing location ring.
- Keep map pitch zero initially and route labels legible.
- Tiny interface transitions: 120–180ms. Position correction may animate for up to 1.5s; do not animate across water or off the route.
- Normal marker interpolation follows route distance, never straight-line interpolation between remote coordinates.
- Honour `prefers-reduced-motion`; show the same information without pulsing or fly-throughs.
- No sound, autoplay video, stock bus hero photo, or decorative chart on the passenger page.

## Copy examples

Use these as patterns, with numbers driven by state:

- “Patuli → Howrah”
- “Choose your stop”
- “No bus is sharing its location right now.”
- “Waiting for the first location.”
- “Estimated · last confirmed 38 sec ago”
- “Location is out of date. Arrival time is unavailable.”
- “Keep this screen open while sharing.”
- “Demo journey · simulated locations”

Avoid “revolutionizing mobility”, “AI-powered precision”, “seamless experience”, and confident “arriving now” when the position is only predicted.

## Visual completion check

Inspect screenshots at 390×844, 768×1024, and 1440×900, plus a 320px overflow check. Review a live state, a stale state, the contributor form, and diagnostics. Check hierarchy, map visibility, no horizontal page overflow, useful whitespace, working focus indicators, and clear reading order. The UI must still feel complete when there is no active journey.
