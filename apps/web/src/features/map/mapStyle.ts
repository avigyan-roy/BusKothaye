import type { WebConfig } from '../../config/site.js';
import type { Theme } from '../../lib/theme.js';

export interface BasemapChoice {
  readonly styleUrl: string;
  readonly provider: 'amazon' | 'none';
  readonly isMissingKey: boolean;
}

/** Amazon Location Maps V2 style consumed directly by MapLibre GL JS. */
export function resolveBasemap(config: WebConfig, theme: Theme): BasemapChoice {
  if (config.mapProvider === 'none') {
    return { styleUrl: '', provider: 'none', isMissingKey: false };
  }
  if (config.locationApiKey.length === 0) {
    return { styleUrl: '', provider: 'amazon', isMissingKey: true };
  }
  const url = new URL(
    `https://maps.geo.${config.awsRegion}.amazonaws.com/v2/styles/Standard/descriptor`,
  );
  url.searchParams.set('key', config.locationApiKey);
  url.searchParams.set('color-scheme', theme === 'light' ? 'Light' : 'Dark');
  url.searchParams.set('poi-density', 'Sparse');
  url.searchParams.set('political-view', 'IND');
  url.searchParams.set('traffic', 'All');
  url.searchParams.set('travel-modes', 'Transit');
  return { styleUrl: url.toString(), provider: 'amazon', isMissingKey: false };
}

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
