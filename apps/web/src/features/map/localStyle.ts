import type { StyleSpecification } from 'maplibre-gl';
import type { Theme } from '../../lib/theme.js';

/**
 * A basemap-free surface for missing credentials, failed AWS map requests, and
 * deterministic browser tests. It is not another map provider: there are no
 * streets or external tiles, and the UI says so while retaining the app-owned
 * route, stops, vehicle and uncertainty overlays.
 */
export function localFallbackStyle(theme: Theme): StyleSpecification {
  return {
    version: 8,
    name: 'BusKothay plain map surface',
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': theme === 'light' ? '#e9f0f4' : '#070c12' },
      },
    ],
  };
}
