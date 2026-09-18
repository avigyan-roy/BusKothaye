import { Router } from 'express';
import {
  ChangePasswordBodySchema,
  LoginBodySchema,
  RegisterBodySchema,
  SelectRoleBodySchema,
} from '@buskothay/shared';
import { bearerToken } from '../auth/capabilities.js';
import { badRequest } from '../http/errors.js';
import type { AccountService } from '../service/account-service.js';

export function createAuthRouter(accounts: AccountService): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    const body = parse(RegisterBodySchema, req.body, 'That account could not be created.');
    res.status(201).json(await accounts.register(body));
  });

  router.post('/login', async (req, res) => {
    const body = parse(LoginBodySchema, req.body, 'That login was not valid.');
    res.json(await accounts.login(body.username, body.password));
  });

  router.get('/me', async (req, res) => {
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    res.json(accounts.toDto(principal.account));
  });

  router.post('/logout', async (req, res) => {
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    await accounts.logout(principal);
    res.status(204).end();
  });

  router.put('/role', async (req, res) => {
    const body = parse(SelectRoleBodySchema, req.body, 'Choose a valid role.');
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    res.json(await accounts.selectRole(principal, body.role));
  });

  router.put('/password', async (req, res) => {
    const body = parse(ChangePasswordBodySchema, req.body, 'That password change was not valid.');
    const principal = await accounts.authenticate(bearerToken(req.get('Authorization')));
    res.json(await accounts.changePassword(principal, body.currentPassword, body.newPassword));
  });

  return router;
}

function parse<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } } },
  value: unknown,
  message: string,
): T {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  throw badRequest(
    message,
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      reason: issue.message,
    })),
  );
}

