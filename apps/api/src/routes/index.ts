import { Router, type Request, type Response } from 'express';
import {
  BoardJourneyBodySchema,
  CreateJourneyBodySchema,
  JoinJourneyBodySchema,
  LocationBodySchema,
  MAX_BATCH_REPORTS,
  RATE_LIMIT_REPORTS_PER_SECOND,
  SCHEMA_VERSION,
  type LocationReport,
} from '@buskothay/shared';
import { z } from 'zod';
import { bearerToken } from '../auth/capabilities.js';
import { ApiProblem, badRequest, rateLimited, routeNotFound } from '../http/errors.js';
import { TokenBucketLimiter } from '../http/rate-limit.js';
import type { JourneyService } from '../service/journey-service.js';
import type { AccountService } from '../service/account-service.js';
import type { RouteRegistry } from './route-registry.js';

export interface ApiDeps {
  readonly service: JourneyService;
  readonly accounts: AccountService;
  readonly registry: RouteRegistry;
  readonly nowMs: () => number;
  readonly rateLimits: {
    readonly createPerMinute: number;
    readonly createBurst: number;
    readonly joinPerMinute: number;
    readonly joinBurst: number;
  };
}

/** Live data, capabilities and diagnostics are never cached anywhere. */
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

function idempotencyKeyOf(req: Request): string | null {
  const header = req.get('Idempotency-Key');
  if (!header) return null;
  const trimmed = header.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

function reportsFrom(body: unknown): LocationReport[] {
  const parsed = LocationBodySchema.safeParse(body);
  if (!parsed.success) {
    throw badRequest(
      'That location report was not valid.',
      parsed.error.issues.slice(0, 12).map((issue) => ({
        path: issue.path.join('.'),
        reason: issue.message,
      })),
    );
  }
  const value = parsed.data;
  return 'updates' in value ? value.updates : [value];
}

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();

  const createLimiter = new TokenBucketLimiter(
    deps.rateLimits.createBurst,
    deps.rateLimits.createPerMinute / 60,
    deps.nowMs,
  );
  const joinLimiter = new TokenBucketLimiter(
    deps.rateLimits.joinBurst,
    deps.rateLimits.joinPerMinute / 60,
    deps.nowMs,
  );
  const reportLimiter = new TokenBucketLimiter(
    RATE_LIMIT_REPORTS_PER_SECOND,
    RATE_LIMIT_REPORTS_PER_SECOND,
    deps.nowMs,
  );

  // --- Routes ---------------------------------------------------------------

  router.get('/routes', (_req, res) => {
    res.json({ schemaVersion: SCHEMA_VERSION, routes: deps.registry.summaries() });
  });

  router.get('/routes/:routeId', (req, res) => {
    const route = deps.registry.get(req.params.routeId);
    if (route === null) {
      if (deps.registry.has(req.params.routeId)) {
        throw new ApiProblem(
          409,
          'ROUTE_UNAVAILABLE',
          'This route is listed by WBTC, but verified tracking geometry is not available yet.',
        );
      }
      throw routeNotFound();
    }
    // Route data only changes when its version changes, so it is safe to cache
    // against that version — unlike anything about a live journey.
    res.setHeader('ETag', `"${route.dto.version}"`);
    res.setHeader('Cache-Control', 'public, max-age=60');
    if (req.get('If-None-Match') === `"${route.dto.version}"`) {
      res.status(304).end();
      return;
    }
    res.json(route.dto);
  });

  router.get('/routes/:routeId/journeys', async (req, res) => {
    noStore(res);
    const journeys = await deps.service.listJourneys(req.params.routeId);
    res.json({ schemaVersion: SCHEMA_VERSION, journeys, serverTs: deps.nowMs() });
  });

  // --- Journey lifecycle ----------------------------------------------------

  router.post('/journeys', async (req, res) => {
    noStore(res);
    const decision = createLimiter.take(clientKey(req));
    if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);

    const parsed = CreateJourneyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest(
        'That journey could not be created.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), reason: i.message })),
      );
    }

    const principal = await deps.accounts.authenticate(bearerToken(req.get('Authorization')));
    const response = await deps.service.createJourney({
      routeId: parsed.data.routeId,
      principal,
      idempotencyKey: idempotencyKeyOf(req),
    });
    res.status(201).json(response);
  });

  router.post('/journeys/:journeyId/contributors', async (req, res) => {
    noStore(res);
    const decision = joinLimiter.take(clientKey(req));
    if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);

    const parsed = JoinJourneyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      // A body asking for role "driver" fails here. Driver capability comes from
      // creating a journey and from nowhere else.
      throw badRequest(
        'That join request was not valid.',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), reason: i.message })),
      );
    }

    const principal = await deps.accounts.authenticate(bearerToken(req.get('Authorization')));
    const response = await deps.service.joinJourney({
      journeyId: req.params.journeyId,
      joinCode: parsed.data.joinCode,
      role: parsed.data.role,
      principal,
      idempotencyKey: idempotencyKeyOf(req),
    });
    res.status(201).json(response);
  });

  router.post('/journeys/:journeyId/board', async (req, res) => {
    noStore(res);
    const decision = joinLimiter.take(clientKey(req));
    if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);

    const parsed = BoardJourneyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest(
        'That boarding request was not valid.',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          reason: issue.message,
        })),
      );
    }
    const principal = await deps.accounts.authenticate(bearerToken(req.get('Authorization')));
    const response = await deps.service.boardJourney({
      journeyId: req.params.journeyId,
      stopId: parsed.data.stopId,
      principal,
      idempotencyKey: idempotencyKeyOf(req),
    });
    res.status(201).json(response);
  });

  router.post('/journeys/:journeyId/locations', async (req, res) => {
    noStore(res);
    const token = bearerToken(req.get('Authorization'));
    const auth = await deps.service.authoriseContributor(req.params.journeyId, token);

    const decision = reportLimiter.take(auth.contributor.contributorId);
    if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);

    const reports = reportsFrom(req.body);
    if (reports.length > MAX_BATCH_REPORTS) {
      throw badRequest(`A batch may contain at most ${MAX_BATCH_REPORTS} reports.`);
    }

    const response = await deps.service.submitLocations({
      journeyId: req.params.journeyId,
      contributorId: auth.contributor.contributorId,
      reports,
      receivedAtMs: requestReceivedAt(req),
      requestId: requestId(res),
    });
    res.status(202).json(response);
  });

  router.delete('/journeys/:journeyId/contributors/me', async (req, res) => {
    noStore(res);
    const token = bearerToken(req.get('Authorization'));
    const auth = await deps.service.authoriseContributor(req.params.journeyId, token);
    const stateVersion = await deps.service.revokeSelf(
      req.params.journeyId,
      auth.contributor.contributorId,
    );
    res.json({
      schemaVersion: SCHEMA_VERSION,
      journeyId: req.params.journeyId,
      revoked: true,
      stateVersion,
    });
  });

  router.post('/journeys/:journeyId/end', async (req, res) => {
    noStore(res);
    const token = bearerToken(req.get('Authorization'));
    const principal = await deps.accounts.authenticate(token);
    await deps.service.authoriseJourneyControl(req.params.journeyId, principal);

    const { endedAtMs, stateVersion } = await deps.service.endJourney(req.params.journeyId);
    res.json({
      schemaVersion: SCHEMA_VERSION,
      journeyId: req.params.journeyId,
      mode: 'ENDED',
      endedAtMs,
      stateVersion,
    });
  });

  // --- Reads ----------------------------------------------------------------

  router.get('/journeys/:journeyId/state', async (req, res) => {
    noStore(res);
    res.json(await deps.service.getState(req.params.journeyId));
  });

  router.get('/journeys/:journeyId/debug', async (req, res) => {
    noStore(res);
    // Protected for demo journeys too: a demo still carries real contributors'
    // projected positions and decision history.
    const token = bearerToken(req.get('Authorization'));
    await deps.service.authoriseDebugRead(req.params.journeyId, token);
    res.json(await deps.service.getDebug(req.params.journeyId));
  });

  return router;
}

/**
 * Rate-limit bucket for an unauthenticated caller.
 *
 * `req.ip` already respects the configured number of trusted proxy hops, so a
 * client cannot choose its own bucket with a forged forwarding header.
 */
function clientKey(req: Request): string {
  return req.ip ?? 'unknown';
}

const RECEIVED_AT = Symbol.for('buskothay.receivedAt');

export function markReceived(req: Request, nowMs: number): void {
  (req as unknown as Record<symbol, number>)[RECEIVED_AT] = nowMs;
}

function requestReceivedAt(req: Request): number {
  return (req as unknown as Record<symbol, number>)[RECEIVED_AT] ?? Date.now();
}

function requestId(res: Response): string {
  return String(res.getHeader('X-Request-Id') ?? 'unknown');
}

export const ParamsSchema = z.object({ journeyId: z.string().min(1) });
