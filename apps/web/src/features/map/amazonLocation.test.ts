import { describe, expect, it } from 'vitest';
import { loadWebConfig, productionConfigProblems } from '../../config/site.js';
import { parseCalculateRoutesResponse } from './amazonLocation.js';
import { resolveBasemap } from './mapStyle.js';

describe('Amazon Location integration', () => {
  it('builds the Maps V2 style for the selected theme and AWS region', () => {
    const config = loadWebConfig({
      VITE_API_BASE_URL: 'https://api.example.com',
      VITE_AWS_REGION: 'ap-south-1',
      VITE_LOCATION_API_KEY: 'v1.public.example',
    });
    const basemap = resolveBasemap(config, 'light');
    const url = new URL(basemap.styleUrl);
    expect(url.hostname).toBe('maps.geo.ap-south-1.amazonaws.com');
    expect(url.pathname).toBe('/v2/styles/Standard/descriptor');
    expect(url.searchParams.get('color-scheme')).toBe('Light');
    expect(url.searchParams.get('traffic')).toBe('All');
    expect(url.searchParams.get('political-view')).toBe('IND');
  });

  it('rejects a deployment without the Amazon Location key', () => {
    const config = loadWebConfig({ VITE_API_BASE_URL: 'https://api.example.com' });
    expect(productionConfigProblems(config)).toContain(
      'VITE_LOCATION_API_KEY is required for a deployment build',
    );
  });

  it('rejects an invalid Amazon Location region in a deployment build', () => {
    const config = loadWebConfig({
      VITE_API_BASE_URL: 'https://api.example.com',
      VITE_AWS_REGION: 'kolkata',
      VITE_LOCATION_API_KEY: 'v1.public.example',
    });
    expect(productionConfigProblems(config)).toContain(
      'VITE_AWS_REGION must be a valid AWS region name',
    );
  });

  it('joins ordered leg geometry without repeating shared endpoints', () => {
    expect(
      parseCalculateRoutesResponse({
        Routes: [
          {
            Legs: [
              { Geometry: { LineString: [[88.3, 22.5], [88.4, 22.6]] } },
              { Geometry: { LineString: [[88.4, 22.6], [88.5, 22.7]] } },
            ],
            Summary: { Distance: 1234, Duration: 321 },
          },
        ],
      }),
    ).toEqual({
      coordinates: [[88.3, 22.5], [88.4, 22.6], [88.5, 22.7]],
      distanceM: 1234,
      durationMs: 321_000,
    });
  });

  it('rejects malformed route geometry instead of publishing it', () => {
    expect(() =>
      parseCalculateRoutesResponse({
        Routes: [{ Legs: [{ Geometry: { LineString: [[188.3, 22.5]] } }] }],
      }),
    ).toThrow('AMAZON_LOCATION_ROUTE_INVALID');
  });
});
