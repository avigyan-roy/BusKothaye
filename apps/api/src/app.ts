import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, {
  json,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { MAX_BODY_BYTES, systemClock, type Clock } from '@buskothay/shared';
import type { AppConfig } from './config.js';
import { ApiProblem } from './http/errors.js';
import { createApiRouter, markReceived } from './routes/index.js';
import type { RouteRegistry } from './routes/route-registry.js';
import { JourneyService } from './service/journey-service.js';
import type { JourneyRepository } from './store/types.js';
import { createLogger, type Logger } from './observability/logger.js';

/**
 * Builds the Express application without binding a port, so tests can drive it on
 * an ephemeral server and `server.ts` can own configuration and shutdown.
 */

export interface AppDeps {
  readonly config: AppConfig;
  readonly repo: JourneyRepository;
  readonly registry: RouteRegistry;
  readonly clock?: Clock;
  readonly logger?: Logger;
}

export interface BuiltApp {
  readonly app: Express;
  readonly service: JourneyService;
  readonly logger: Logger;
}

export function createApp(deps: AppDeps): BuiltApp {
  const clock = deps.clock ?? systemClock;
  const logger = deps.logger ?? createLogger(deps.config.logLevel);
  const service = new JourneyService(deps.repo, deps.registry, clock, logger);

  const app = express();
  app.disable('x-powered-by');
  // Only the configured number of proxy hops is believed; App Runner puts one in
  // front of the container.
  app.set('trust proxy', deps.config.trustProxyHops);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    markReceived(req, clock.nowMs());
    const startedAt = clock.monotonicMs();
    res.on('finish', () => {
      logger.info('request', {
        requestId: id,
        method: req.method,
        // The path template, not the URL: a URL can carry a journey ID, and one
        // day someone will put something worse in a query string.
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(clock.monotonicMs() - startedAt),
      });
    });
    next();
  });

  app.use(
    cors({
      origin: [...deps.config.corsOrigins],
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'If-None-Match'],
      maxAge: 600,
    }),
  );

  app.use(json({ limit: MAX_BODY_BYTES }));

  app.get('/health', (_req, res) => {
    // Liveness is local and cheap: it must not depend on reaching DynamoDB, or a
    // storage blip would cause the platform to restart a healthy process.
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok' });
  });

  app.get('/ready', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ready = await deps.repo.ready().catch(() => false);
    // Deliberately bare: readiness says yes or no and reveals nothing else.
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready' });
  });

  app.use(
    '/v1',
    createApiRouter({
      service,
      registry: deps.registry,
      nowMs: () => clock.nowMs(),
      rateLimits: deps.config.rateLimits,
    }),
  );

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'No such endpoint.',
        requestId: String(res.getHeader('X-Request-Id') ?? ''),
      },
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const requestId = String(res.getHeader('X-Request-Id') ?? '');
    res.setHeader('Cache-Control', 'no-store');

    if (error instanceof ApiProblem) {
      for (const [header, value] of Object.entries(error.headers ?? {})) {
        res.setHeader(header, value);
      }
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.fields ? { fields: error.fields } : {}),
        },
      });
      return;
    }

    if (isBodyTooLarge(error)) {
      res.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'That request body is too large.', requestId },
      });
      return;
    }

    if (isMalformedJson(error)) {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'That request body was not valid JSON.', requestId },
      });
      return;
    }

    logger.error('unhandled error', {
      requestId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    // Nothing from the exception reaches the client: no stack, no rejected value.
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Something went wrong on our side.', requestId },
    });
  });

  return { app, service, logger };
}

function isBodyTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type: unknown }).type === 'entity.too.large'
  );
}

function isMalformedJson(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    'body' in error &&
    typeof (error as { body: unknown }).body !== 'undefined'
  );
}
