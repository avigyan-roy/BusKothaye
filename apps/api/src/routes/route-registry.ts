import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  RouteCatalogueSchema,
  prepareRoute,
  type AdminRouteRecord,
  type PreparedRoute,
  type RouteCatalogueEntry,
  type RouteFixture,
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
    private readonly fixturesByVersion: Map<string, RouteFixture>,
    private readonly adminRecords: Map<string, AdminRouteRecord>,
  ) {}

  static async load(directory: string): Promise<RouteRegistry> {
    const dir = resolve(directory);
    const files = (await readdir(dir)).filter(
      (name) => name.endsWith('.json') && name !== 'catalog.json',
    );
    const catalogueRaw = JSON.parse(await readFile(join(dir, 'catalog.json'), 'utf8')) as unknown;
    const catalogueList = RouteCatalogueSchema.parse(catalogueRaw).routes;
    const colors = new Set<string>();
    for (const entry of catalogueList) {
      if (colors.has(entry.color)) throw new Error(`Route colour ${entry.color} is used more than once`);
      colors.add(entry.color);
    }
    const catalogue = new Map(catalogueList.map((entry) => [entry.id, entry]));
    const routesByVersion = new Map<string, PreparedRoute>();
    const fixturesByVersion = new Map<string, RouteFixture>();
    for (const file of files.sort()) {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown;
      const prepared = prepareRoute(raw);
      const entry = catalogue.get(prepared.dto.id);
      if (entry && entry.color !== prepared.dto.color) {
        throw new Error(
          `Route ${entry.id} uses ${entry.color} in the catalogue but ${prepared.dto.color} in its fixture`,
        );
      }
      routesByVersion.set(versionKey(prepared.dto.id, prepared.dto.version), prepared);
      fixturesByVersion.set(
        versionKey(prepared.dto.id, prepared.dto.version),
        raw as RouteFixture,
      );
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
    return new RouteRegistry(catalogue, routesByVersion, fixturesByVersion, new Map());
  }

  /** Apply durable administrator overrides before the server starts listening. */
  applyOverrides(records: readonly AdminRouteRecord[]): void {
    for (const record of records) this.upsert(record);
  }

  /** Validate and activate a new immutable route version. */
  upsert(record: AdminRouteRecord): PreparedRoute {
    const prepared = prepareRoute(record.route);
    const key = versionKey(record.route.id, record.route.version);
    this.routesByVersion.set(key, prepared);
    this.fixturesByVersion.set(key, record.route);
    this.adminRecords.set(record.route.id, record);
    this.catalogue.set(record.route.id, {
      id: record.route.id,
      code: record.route.code,
      color: record.route.color,
      name: record.route.name,
      origin: record.route.origin,
      destination: record.route.destination,
      listedOrigin: record.route.origin,
      listedDestination: record.route.destination,
      direction: record.route.direction,
      activeVersion: record.route.version,
      officialSourceUrl:
        record.route.provenance.officialSourceUrl ?? 'https://www.google.com/maps',
      retrievedOn: record.route.provenance.verifiedOn,
      missing: null,
    });
    return prepared;
  }

  editableRoutes(): AdminRouteRecord[] {
    const records: AdminRouteRecord[] = [];
    for (const entry of this.catalogue.values()) {
      if (!entry.activeVersion) continue;
      const admin = this.adminRecords.get(entry.id);
      if (admin) {
        records.push(admin);
        continue;
      }
      const route = this.fixturesByVersion.get(versionKey(entry.id, entry.activeVersion));
      if (route) records.push({ route, updatedAtMs: 0, updatedBy: 'Bundled seed data' });
    }
    return records.sort((a, b) => a.route.code.localeCompare(b.route.code));
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
        color: entry.color,
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
