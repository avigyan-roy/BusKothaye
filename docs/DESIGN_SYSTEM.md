# Design direction — a quiet Kolkata transit instrument

Build a clear, practical transport interface with a local identity. The map is the product: a passenger opens the site onto a dark, full-screen street map and reads where the bus is, how fresh that is, which stop is next and when it should arrive. Everything else sits over the map and is sized to leave the map visible. The visual language is closer to a transit instrument—rectilinear, labelled, information-dense where necessary—than to a rounded SaaS dashboard.

The researched rationale, rejected patterns, before/after audit, and rules for future AI work live in [design/ANTI_VIBE_UI.md](design/ANTI_VIBE_UI.md). Read that file before introducing a new component pattern.

Superseded direction: the first release used a warm off-white canvas with a forest-green accent and a document-flow panel below the map. The user replaced it with the dark, map-first direction recorded below. Historic descriptions of the light palette in `IMPLEMENTATION_PLAN.md` no longer describe the application.

## Palette: use these tokens

Put these in `apps/web/src/styles/tokens.css`; components reference variables rather than repeating hex codes.

```css
:root {
  color-scheme: dark;

  /* Three surface levels: the map, a sheet, a raised row inside it. */
  --color-canvas: #0D0F0E;
  --color-surface: #151817;
  --color-surface-raised: #1B1F1D;
  --color-surface-overlay: #151817;

  --color-border: rgba(255, 255, 255, 0.12);
  --color-border-strong: rgba(255, 255, 255, 0.2);

  --color-ink: #EEF0EA;
  --color-muted: #A8ADA6;
  --color-faint: #858B84;

  /* One accent: the route, the primary action, the selected stop. */
  --color-accent: #E5BD45;
  --color-accent-hover: #F0CA5C;
  --color-accent-soft: rgba(229, 189, 69, 0.14);
  --color-on-accent: #14170F;

  --color-live: #69B77B;
  --color-warning: #D79B45;   /* demo and warning share one amber */
  --color-warning-soft: rgba(215, 155, 69, 0.14);
  --color-stale: #D87355;
  --color-danger: #D65F5F;
  --color-danger-hover: #E07474;
  --color-on-danger: #1A0E0E;
  --color-focus: #8EB6FF;

  /* Drawn on the map itself, where the tokens above cannot reach. */
  --map-route: #E5BD45;
  --map-route-casing: #0B0D0C;
  --map-stop: #C9CEC6;
  --map-stop-passed: #6B716A;
  --map-vehicle: #F1F2ED;
  --map-user: #8EB6FF;

  --radius-control: 2px;
  --radius-panel: 0px;
  --radius-sheet: 0px;
}
```

Use no more than one accent, one live colour, one demo/warning colour, one error colour and three surface levels. Contrast against `--color-surface`: ink 15.57:1, muted 7.82:1, faint 5.13:1, accent 9.96:1, live 7.37:1, warning 7.37:1, stale 5.54:1, danger 4.82:1 — all at or above WCAG AA. The accent is also a status colour, so every tracking state carries a glyph shape and a word as well as a hue; nothing is distinguished by colour alone. Warning and danger colours appear only when their meaning applies. Do not tint the whole interface during an outage.

Rounded rectangles are not the default. Ordinary groups use spacing, type and horizontal rules. Controls use a 2px construction tolerance so browser rendering does not look jagged; route/status circles remain circular because their shape encodes geography or state. Do not add glass blur, glow, decorative gradient, floating orb, or shadow-based depth.

## Typography

- Use one system sans-serif stack with a Bengali fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Bengali", "Noto Sans", sans-serif`.
- Body: 16px, line height 1.5. Secondary text: 14px. Metadata: minimum 12px; never put a primary action or ETA qualification at that size.
- Stop name in the sheet: 20px mobile, 24px desktop, weight 600.
- ETA: 28px mobile / 32px desktop, weight 600, tabular numerals. The unit `min` is smaller and regular weight.
- Route code `AC24`: 14px, weight 700, compact accent label, 1px construction radius. This is the strongest identifier after the wordmark.
- Use the monospace stack only for the wordmark, route identifiers, codes and diagnostic values. It provides a transit-signage/data contrast without turning body copy into a developer console.
- Three weights at most (400/600/700). Sentence case. Avoid wide letter spacing and uppercase labels.
- Bengali support may be added later through the copy dictionary; do not add a nonfunctional language switch.

## Mobile layout: 320–899px

Design at 390×844 first, then verify 320×720 and a short viewport (640×450 at 200% zoom is 320×225 CSS pixels). The map fills `100dvh`; the main screen never scrolls as a page.

```text
┌─────────────────────────────┐
│ [≡]  ● Live · Updated 8 sec │  44px menu + one small status plate
│  Development basemap …      │  disclosure only when one applies
│                             │
│           MAP               │  dark streets, accent route, one vehicle
│                             │
│                       [route]│  44px map actions, above the sheet
│                       [follow]│
│                       [locate]│
│                       credits│  attribution, never covered
├──────────── ══ ─────────────┤
│ AC24 [Demo] Patuli → Howrah ⌃│  collapsed sheet, about 104–132px
│ Gariahat            6–9 min │
│ 940 m to this stop          │
└─────────────────────────────┘
```

Expanded, the sheet stops at about 66dvh so part of the map stays visible, and its detail region scrolls internally rather than moving the page. The detail region is `inert` while collapsed, so a keyboard never lands on a control nobody can see. Expansion is a labelled button, not a drag gesture. On a short viewport the whole sheet scrolls instead and the least important line (distance and accuracy) is dropped.

The sheet measures itself into `--sheet-measured-h`; the map actions and the map attribution are positioned against it so they move with the sheet and never collide. Zoom buttons and the scale bar are hidden below 900px — pinch, wheel and keyboard still zoom.

No page header on the map screen. Navigation — passenger map, route catalogue, share GPS, demo console, account, sign out — lives in the menu panel behind the top-left button, which is a native `<dialog>` so Escape, the focus trap and focus return come from the browser.

## Desktop: 900px and above

- The map still fills the viewport. Do not turn the screen into a dashboard.
- The journey sheet becomes a drawer on the left, `--panel-width` (360px) wide, inset from the viewport edge, open by default because it materially helps; the same chevron collapses it.
- The menu button and status plate stay at the top left, above the drawer. Zoom buttons top right, scale bottom left, locate/follow bottom right.
- The map fit reserves the drawer's width (`--panel-inset`) so the route is never drawn underneath it.
- Avoid large empty panels, oversized type and stretched mobile cards. Same visual language as mobile.

Reflow cleanly for landscape phones, long stop names and browser zoom. Never crop the map attribution.

## Components

**Map controls (`MapControlButton`):** 44×44px, monochrome SVG icon, no text label on the map, 2px radius, opaque surface and one hairline border. No blur or glow. An active control (following the bus) sets `aria-pressed` and shows the accent. Any real map gesture cancels follow mode; the same button resumes it.

**Status plate (`JourneyStatus`):** the one place the tracking state is written — glyph, word and freshness ("Live · Updated 8 sec ago"). It is sized by its text and never spans the screen. A failing connection outranks the mode. With no journey it reads "No active bus".

**Journey sheet (`JourneySheet`):** one component, laid out by CSS as a bottom sheet or a left drawer. Collapsed it carries route code, demo label, direction, stop, ETA and distance. Expanded it adds the journey selector, the stop list, the route catalogue and route provenance.

**Arrival (`ArrivalPanel`):** selected stop, arrival range, distance. If there is no honest answer, the number is replaced by a sentence — never left underneath a warning as a figure someone might read anyway.

**Stop row:** an unbroken route line down the marker column, stop name, one secondary status line, arrival aligned right. Passed stops are hollow, smaller and muted; the stop the bus is at is filled and ringed in accent; upcoming stops are plain filled dots. State is in the words too. At least 44px tall, keyboard selectable.

**Buttons:** minimum 44×44px touch area; primary accent with `--color-on-accent` text, secondary raised surface with a hairline border. One main action per panel. Destructive end action has a confirmation dialog; ordinary stop-sharing is immediate.

**Forms:** labels above inputs, 16px input text, inline errors, clear pending state. Join code accepts typing/paste and normalizes harmless spacing/case.

**Ordinary-page sections:** do not wrap every section in a filled card. `.panel` is a top rule plus spacing. Add a fully bounded container only when the boundary itself communicates interaction, state or independent selection.

**Notices:** use one complete semantic border and specific copy. Never use a decorative coloured stripe on the left. Route colours appear as small square swatches beside route codes because they are a real legend, not decoration.

**Ops, contributor, account, demo console:** ordinary page layouts with the site header, sharing this palette, typography, compact controls and hairline borders. A diagnostic screen, not a separate neon dashboard.

## Map styling

- Production uses Amazon Location Maps V2 with `color-scheme=Dark`: near-black land, slightly lighter roads, muted labels, minimal noise. The basemap is never fully black — street context has to remain readable.
- The development basemap (MapLibre demo tiles) has only a light palette, so its layers are recoloured to these surfaces at load. That is a recolour of the fallback, not the production map, and the disclosure over the map still says which one is in use.
- Route: one saturated accent line over a dark casing, width interpolated by zoom. No glow, no decorative parallel lines.
- Stops: small circles, quiet by default, differentiated by size and fill as well as colour. Names appear from zoom 13, and always for the selected stop.
- Vehicle: the only near-white mark on the map, over a dark casing; hollow once the position is an estimate, faded when stale. Heading is not drawn, because the public state carries no heading. A demo vehicle is labelled `Demo` on the map as well as in the sheet.
- User location: a blue dot with a dark ring — deliberately a different colour and construction from the vehicle.
- Uncertainty is drawn in real metres on the ground, so it grows and shrinks with the scale as the real uncertainty does.
- Only display verified route geometry. A catalogue-only route shows "Map geometry not available", never an invented line.

## Motion

- Interface transitions 120–180ms; the sheet animates a real measured height.
- Position correction may animate for up to 1.5s; do not animate across water or off the route.
- Marker interpolation follows route distance, never a straight line between remote coordinates.
- No bounce, spring, parallax, floating or continuous pulsing. Honour `prefers-reduced-motion`.
- No sound, autoplay video, stock bus photo, or decorative chart on the passenger page.

## Copy examples

Use these as patterns, with numbers driven by state:

- “Patuli → Howrah”
- “Live · Updated 8 sec ago”
- “No active bus”
- “No bus is sharing its location right now.”
- “Waiting for the first location.”
- “Location is out of date. Arrival time is unavailable.”
- “Map geometry not available”
- “Keep this screen open while sharing.”
- “Demo journey · simulated locations”

Avoid “revolutionizing mobility”, “AI-powered precision”, “seamless experience”, and confident “arriving now” when the position is only predicted.

## Visual completion check

Inspect screenshots at 390×844, 320×720, 1440×900 and 320×225 (640×450 at 200% zoom), plus the 768×1024 tablet width. `npm run screenshots` captures all five and fails on horizontal page overflow. Review a live state, a stale state, the collapsed and expanded sheet, the contributor form and diagnostics. Check hierarchy, map visibility, no page scrolling on the map screen, that map actions and attribution clear the sheet, working focus indicators and clear reading order. The UI must still feel complete when there is no active journey.
