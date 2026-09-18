import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  RouteCatalogueSchema,
  prepareRoute,
  type PreparedRoute,
  type RouteCatalogueEntry,
  type RouteSummary,
} from '@buskothay/shared';

/**
 * The route fixtures, loaded and validated once at startup.
 *
 * Route data is committed JSON, not database rows: it is versioned, reviewable in
 * a pull request, and needs no query. Loading it once also means no request path
 * calls AWS to find out where the road goes.
 */
export class RouteRegistry {
  private constructor(
    private readonly catalogue: Map<string, RouteCatalogueEntry>,
    private readonly routesByVersion: Map<string, PreparedRoute>,
  ) {}

  static async load(directory: string): Promise<RouteRegistry> {
    const dir = resolve(directory);
    const files = (await readdir(dir)).filter(
      (name) => name.endsWith('.json') && name !== 'catalog.json',
    );
    const catalogueRaw = JSON.parse(await readFile(join(dir, 'catalog.json'), 'utf8')) as unknown;
    const catalogueList = RouteCatalogueSchema.parse(catalogueRaw).routes;
    const catalogue = new Map(catalogueList.map((entry) => [entry.id, entry]));
    const routesByVersion = new Map<string, PreparedRoute>();
    for (const file of files.sort()) {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown;
      const prepared = prepareRoute(raw);
      routesByVersion.set(versionKey(prepared.dto.id, prepared.dto.version), prepared);
    }
    if (routesByVersion.size === 0) {
      throw new Error(`No route fixtures found in ${dir}`);
    }
    for (const entry of catalogue.values()) {
      if (
        entry.activeVersion !== null &&
        !routesByVersion.has(versionKey(entry.id, entry.activeVersion))
      ) {
        throw new Error(`Route ${entry.id} names missing active version ${entry.activeVersion}`);
      }
    }
    return new RouteRegistry(catalogue, routesByVersion);
  }

  get(routeId: string, version?: string): PreparedRoute | null {
    const entry = this.catalogue.get(routeId);
    const selectedVersion = version ?? entry?.activeVersion;
    if (!selectedVersion) return null;
    return this.routesByVersion.get(versionKey(routeId, selectedVersion)) ?? null;
  }

  has(routeId: string): boolean {
    return this.catalogue.has(routeId);
  }

  summaries(): RouteSummary[] {
    return [...this.catalogue.values()].map((entry) => {
      const prepared = this.get(entry.id);
      return {
        id: entry.id,
        version: prepared?.dto.version ?? 'unavailable',
        code: entry.code,
        name: entry.name,
        origin: entry.origin,
        destination: entry.destination,
        direction: entry.direction,
        lengthM: prepared?.dto.lengthM ?? null,
        stopCount: prepared?.dto.stops.length ?? 0,
        isApproximateGeometry: prepared?.dto.provenance.isApproximateGeometry ?? false,
        trackingAvailable: prepared !== null,
        verificationStatus: prepared ? 'geometry-available' : 'geometry-missing',
        listedOrigin: entry.listedOrigin,
        listedDestination: entry.listedDestination,
        officialSourceUrl: entry.officialSourceUrl,
        retrievedOn: entry.retrievedOn,
        missing: entry.missing,
      };
    });
  }
}

function versionKey(routeId: string, version: string): string {
  return `${routeId}@${version}`;
}
