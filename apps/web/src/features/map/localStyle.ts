import type { StyleSpecification } from 'maplibre-gl';

/**
 * A basemap-free style that needs no network at all.
 *
 * Two jobs. It is the deterministic style for browser tests, where depending on
 * an external tile server would make the suite flaky for reasons that have
 * nothing to do with this application. And it is the fallback when the configured
 * basemap cannot be reached: the route line, the stops and the bus still draw on
 * a plain surface, with a notice saying the streets are missing.
 *
 * It is never presented as a map of Kolkata. Without streets a person cannot tell
 * where the bus is relative to anything, so the notice matters as much as the
 * fallback does.
 */
export function localFallbackStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'BusKothay offline surface',
    // An empty glyph/sprite set: nothing here needs either, and pointing at a
    // remote one would defeat the purpose.
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#111312' },
      },
    ],
  };
}
