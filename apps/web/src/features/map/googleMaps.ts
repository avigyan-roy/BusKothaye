import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import type { WebConfig } from '../../config/site.js';

let configuredKey: string | null = null;

function configure(config: WebConfig): void {
  if (configuredKey === config.googleMapsApiKey) return;
  if (configuredKey !== null) {
    throw new Error('Google Maps was already configured with a different key.');
  }
  configuredKey = config.googleMapsApiKey;
  setOptions({ key: config.googleMapsApiKey, v: 'weekly', language: 'en', region: 'IN' });
}

export async function loadGoogleMapLibraries(config: WebConfig) {
  if (!config.googleMapsApiKey) throw new Error('GOOGLE_MAPS_KEY_MISSING');
  configure(config);
  const [maps, marker, core] = await Promise.all([
    importLibrary('maps') as Promise<google.maps.MapsLibrary>,
    importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
    importLibrary('core') as Promise<google.maps.CoreLibrary>,
  ]);
  return { maps, marker, core };
}

export async function loadGoogleRoutesLibrary(config: WebConfig) {
  if (!config.googleMapsApiKey) throw new Error('GOOGLE_MAPS_KEY_MISSING');
  configure(config);
  return importLibrary('routes') as Promise<google.maps.RoutesLibrary>;
}
