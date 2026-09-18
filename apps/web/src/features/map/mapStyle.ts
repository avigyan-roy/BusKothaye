import type { WebConfig } from '../../config/site.js';

/**
 * Where the basemap comes from.
 *
 * Production uses Amazon Location Maps V2 with a restricted browser key. The
 * MapLibre demonstration style is the credential-free development fallback: it
 * renders a real map, which is enough to check the integration, but it has little
 * street detail and it is *not* the production street map. The UI says so
 * wherever it is in use, because a screenshot of the demo style captioned as AWS
 * tiles would be a claim nobody has earned.
 */

export const DEMO_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

export interface BasemapChoice {
  /** Empty when there is no basemap to fetch at all. */
  readonly styleUrl: string;
  readonly provider: 'demo' | 'amazon' | 'none';
  /** True while the development basemap is in use and must be disclosed. */
  readonly isDevelopmentBasemap: boolean;
}

export function resolveBasemap(config: WebConfig): BasemapChoice {
  if (config.mapProvider === 'none') {
    // Explicitly no basemap: used by the browser tests so they do not depend on
    // an external tile server.
    return { styleUrl: '', provider: 'none', isDevelopmentBasemap: false };
  }
  if (config.mapProvider === 'amazon' && config.locationApiKey.length > 0) {
    const url = new URL(
      `https://maps.geo.${config.awsRegion}.amazonaws.com/v2/styles/Standard/descriptor`,
    );
    url.searchParams.set('key', config.locationApiKey);
    // A light street map, no tilt, legible labels — see docs/DESIGN_SYSTEM.md.
    url.searchParams.set('color-scheme', 'Light');
    return { styleUrl: url.toString(), provider: 'amazon', isDevelopmentBasemap: false };
  }
  return { styleUrl: DEMO_STYLE_URL, provider: 'demo', isDevelopmentBasemap: true };
}

/** Whether this browser can draw a WebGL map at all. */
export function supportsWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}
