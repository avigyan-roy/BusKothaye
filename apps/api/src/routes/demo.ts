import { Router } from 'express';
import { z } from 'zod';
import { DemoSwitchBodySchema, DemoUpdateBodySchema } from '@buskothay/shared';
import { bearerToken } from '../auth/capabilities.js';
import { badRequest, forbidden } from '../http/errors.js';
import type { AccountService } from '../service/account-service.js';
import type { DemoService } from '../service/demo-service.js';
import { requireAdmin } from '../service/demo-service.js';

const LeaseBodySchema = z.object({
  ownerId: z.string().min(1).max(128),
  generation: z.number().int().nonnegative(),
});

export function createDemoRouter(accounts: AccountService, demo: DemoService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    requireAdmin(principal);
    res.json(await demo.get());
  });

  router.put('/', async (req, res) => {
    const body = parse(DemoSwitchBodySchema, req.body);
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    res.json(await demo.switch(principal, body.enabled, body.config ?? {}));
  });

  router.patch('/', async (req, res) => {
    const body = parse(DemoUpdateBodySchema, req.body);
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    res.json(await demo.update(principal, body));
  });

  router.post('/reset', async (req, res) => {
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    res.json(await demo.reset(principal));
  });

  router.get('/worker/control', async (req, res) => {
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    if (principal.account.kind !== 'simulator') throw forbidden();
    res.json(await demo.get());
  });

  router.post('/worker/lease', async (req, res) => {
    const body = parse(LeaseBodySchema, req.body);
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    res.json(await demo.acquireLease(principal, body.ownerId, body.generation));
  });

  return router;
}

function parse<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } } },
  value: unknown,
): T {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  throw badRequest(
    'Those demo settings were not valid.',
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      reason: issue.message,
    })),
  );
}
