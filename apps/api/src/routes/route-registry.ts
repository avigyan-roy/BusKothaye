import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prepareRoute, type PreparedRoute, type RouteSummary } from '@buskothay/shared';

/**
 * The route fixtures, loaded and validated once at startup.
 *
 * Route data is committed JSON, not database rows: it is versioned, reviewable in
 * a pull request, and needs no query. Loading it once also means no request path
 * calls AWS to find out where the road goes.
 */
export class RouteRegistry {
  private constructor(private readonly routes: Map<string, PreparedRoute>) {}

  static async load(directory: string): Promise<RouteRegistry> {
    const dir = resolve(directory);
    const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
    const routes = new Map<string, PreparedRoute>();
    for (const file of files.sort()) {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown;
      const prepared = prepareRoute(raw);
      routes.set(prepared.dto.id, prepared);
    }
    if (routes.size === 0) {
      throw new Error(`No route fixtures found in ${dir}`);
    }
    return new RouteRegistry(routes);
  }

  get(routeId: string): PreparedRoute | null {
    return this.routes.get(routeId) ?? null;
  }

  has(routeId: string): boolean {
    return this.routes.has(routeId);
  }

  summaries(): RouteSummary[] {
    return [...this.routes.values()].map(({ dto }) => ({
      id: dto.id,
      version: dto.version,
      code: dto.code,
      name: dto.name,
      origin: dto.origin,
      destination: dto.destination,
      direction: dto.direction,
      lengthM: dto.lengthM,
      stopCount: dto.stops.length,
      isApproximateGeometry: dto.provenance.isApproximateGeometry,
    }));
  }
}
