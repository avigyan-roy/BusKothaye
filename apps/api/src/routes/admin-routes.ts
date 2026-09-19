import { Router } from 'express';
import {
  AdminRouteSaveRequestSchema,
  prepareRoute,
  RouteValidationError,
  SCHEMA_VERSION,
} from '@buskothay/shared';
import { bearerToken } from '../auth/capabilities.js';
import { ApiProblem, badRequest } from '../http/errors.js';
import type { AccountService } from '../service/account-service.js';
import { requireAdmin } from '../service/demo-service.js';
import type { JourneyRepository } from '../store/types.js';
import type { RouteRegistry } from './route-registry.js';

/** Server-protected route, stop, geometry and timetable administration. */
export function createAdminRoutesRouter(
  accounts: AccountService,
  repo: JourneyRepository,
  registry: RouteRegistry,
  nowMs: () => number,
): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    requireAdmin(principal);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ schemaVersion: SCHEMA_VERSION, routes: registry.editableRoutes() });
  });

  router.put('/:routeId', async (req, res) => {
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    requireAdmin(principal);
    const parsed = AdminRouteSaveRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest(
        'That route could not be saved.',
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          reason: issue.message,
        })),
      );
    }
    if (parsed.data.route.id !== req.params.routeId) {
      throw badRequest('The route ID in the address and body must match.');
    }
    const current = registry.get(parsed.data.route.id);
    if (current?.dto.version === parsed.data.route.version) {
      throw new ApiProblem(
        409,
        'CONFLICT',
        'Change the route version before publishing edited geometry, stops, or times.',
      );
    }

    const record = {
      route: parsed.data.route,
      updatedAtMs: nowMs(),
      updatedBy: principal.account.username,
    };
    try {
      // Validate before the durable write, then activate only after it succeeds.
      prepareRoute(record.route);
    } catch (error) {
      if (error instanceof RouteValidationError) {
        throw badRequest(
          'The route geometry and stops did not pass validation.',
          error.problems.map((reason, index) => ({ path: `route.${index}`, reason })),
        );
      }
      throw error;
    }
    await repo.putRouteOverride(record);
    registry.upsert(record);
    res.setHeader('Cache-Control', 'no-store');
    res.json(record);
  });

  return router;
}
