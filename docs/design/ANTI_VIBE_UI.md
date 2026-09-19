# BusKothay anti-template UI record

This is the durable design review for BusKothay. It exists so a future developer or coding agent can understand *why* the interface looks the way it does and does not gradually turn it back into a generic dark SaaS dashboard.

The goal is not to prove that AI was or was not involved. The goal is a specific, trustworthy Kolkata transit product whose visual choices explain the map, the route, the vehicle state and the next useful action.

## Research used

- [The Fountain Institute: “7 Signs a UI Has Been Vibe Coded”](https://www.thefountaininstitute.com/blog/signs-vibe-coded-ui) — useful warnings about competing neon colours, decorative dark-mode glow, emoji iconography, purple gradients, cards around every block, arbitrary multicolour tabs and meaningless status dots.
- [VibeMole: “How to Avoid Building Apps That Look Vibe Coded”](https://vibemole.com/resources/avoid-vibecoded-app-design) — useful checks for nested cards, equal-weight feature grids, pill spam, generic copy, flat typography, one-sided coloured borders, fake evidence and motion without state meaning.
- [Awwwards 2020 Site of the Year Users’ Choice: DARK](https://www.awwwards.com/annual-awards-2020/site-of-the-year-users-choice) — a dark data-rich experience praised for guiding people through complicated information. The applicable lesson is controlled disclosure and hierarchy, not its entertainment styling.
- [CSS Design Awards: Darker Lights](https://www.cssdesignawards.com/sites/darker-lights/36325/) — a dark, minimal, typographic WOTD. The applicable lesson is restraint and typographic composition.
- [CSS Design Awards: Robuust Digital](https://www.cssdesignawards.com/sites/robuust-digital/37250/) — a WOTD explicitly described as clear with subtle, performant effects. The applicable lesson is that motion earns its place through feedback.
- [Awwwards “Hot Right Now” case study: Humana](https://assets.awwwards.com/awards/gallery/2023/07/HOT-RIGHT-NOW-BOOK-2023.pdf) — a dark-first awarded site whose palette is a deliberate decision rather than a generic “premium” effect.

Award galleries are inspiration, not product requirements. Many awarded sites prioritise spectacle, scrolling and storytelling; BusKothay prioritises a map that works outdoors, on a phone, under time pressure. Never copy an awarded layout or effect without a transit-use reason.

## Product-specific visual thesis

BusKothay should feel like a quiet transit instrument at night:

- The street map is the largest visual and the source of geographic truth.
- Charcoal surfaces resemble physical information panels, not translucent glass.
- Amber belongs to the selected route and primary action.
- Green, orange and red appear only for named operational states.
- Route colours are a real legend. They appear as small square swatches, never decorative bars.
- Rectilinear geometry is the default. Circles are reserved for stops, positions and status marks where the shape has meaning.
- Typography, spacing and rules create grouping. A box is not the default answer to “these things belong together.”
- Copy names the real action or state: “Dispatch demo fleet”, “No active bus”, “Location is out of date”. It does not promise a “seamless mobility experience”.

## Audit completed on 2026-09-19

What already worked and was retained:

- map-first passenger screen instead of a marketing landing page;
- one amber accent and labelled operational colours;
- real route, stop, ETA and freshness information;
- no purple gradient, fake statistic, testimonial, stock photo, emoji navigation or abstract hero art;
- consistent SVG map controls and meaningful labelled status glyphs;
- motion tied to sheet height and vehicle position, with reduced-motion support.

What was removed or replaced:

| Previous pattern | Why it weakened the product | Replacement |
| --- | --- | --- |
| 8–16px radii across controls, panels and sheets | Made unrelated elements look like the same component-library card | 0–2px construction radii; geographic/status circles remain circular |
| Filled bordered `.panel` around every ordinary-page section | Produced a stack of equal-weight cards | Transparent ruled sections using spacing and a top hairline |
| Glass-like blur on floating map furniture | Decorative depth without information | Opaque charcoal surface and a hairline border |
| Coloured left edges on notices, map warnings and boarding | Repeated an AI-dashboard accent-strip pattern | Complete semantic border plus explicit text |
| Tall coloured bar for every route row | Looked like multicolour side-tab decoration | Small square route swatch beside the route code |
| Repeated eyebrow labels above page titles | Added a generic section-kicker rhythm | Direct headings; retain metadata only where it changes meaning |
| Rounded status chip in the demo console | Looked like a decorative pill | Square outlined state label tied to ON/OFF |
| Shadow-led separation | Suggested floating cards | Surface contrast and borders; shadows are disabled |

## Rules for future UI work

Before adding a visible element, answer these questions in the pull request or design note:

1. What passenger, contributor or operator decision does this help?
2. Why does it need its own boundary instead of spacing or a rule?
3. Does its colour map to route identity, selection, focus or a named state?
4. Does motion explain a change, or is it merely proving the page is alive?
5. Would the copy still identify BusKothay if the product name were removed?
6. Is the same fact already visible somewhere more important?

Hard constraints:

- no purple/blue “technology” gradient, decorative glow, glassmorphism or blurred orb;
- no rounded card grid, nested cards, floating icon tile or pill badge as filler;
- no emoji as interface icon and no arbitrary mixture of icon families;
- no fake map activity, fake passenger count, testimonial, partner logo or performance claim;
- no colour-only state, unlabelled status dot or pulsing indicator without a changing process;
- no generic headings such as “Powerful features” or “Everything you need”;
- no animation longer than needed to preserve spatial continuity or confirm state;
- no redesign that reduces map area to make room for decoration.

Allowed exceptions must carry meaning. Examples: a circular stop marker represents a place; the blue user-location dot follows map convention; a route swatch identifies a catalogue line; a bordered notice communicates an error or warning; a filled primary button identifies the page’s main action.

## Review checklist

- Compare 390×844, 320×720, 768×1024, 1440×900 and 320×225 layouts.
- Check the useful hierarchy with colour temporarily ignored.
- Count bounded containers: every one must be interactive, independently selectable or state-bearing.
- Check that amber is not competing with another decorative accent.
- Read headings and actions aloud; they must name concrete BusKothay behavior.
- Verify focus, keyboard order, 44px touch targets, 200% zoom and reduced motion.
- Verify empty, pending, live, estimated, stale, outage, ended and no-geometry states.
- Run `npm run lint`, `npm run typecheck`, `npm run build -w @buskothay/web`, the relevant browser tests and `npm run screenshots` when a browser is available.

## Ownership

The executable source of truth is `apps/web/src/styles/tokens.css` plus component CSS. `docs/DESIGN_SYSTEM.md` specifies the layout and components. This file records the critical design judgment and anti-regression rules. Update all three when changing the visual thesis; do not leave a new direction only in a chat transcript.
