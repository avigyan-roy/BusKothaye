import { z } from 'zod';
import { EpochMsSchema, IdSchema, SchemaVersionSchema } from './common.js';

export const AccountRoleSchema = z.enum(['passenger', 'driver', 'conductor']);
export type AccountRole = z.infer<typeof AccountRoleSchema>;

export const UsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, numbers, hyphens or underscores.');

export const PasswordSchema = z.string().min(10).max(200);

export const RegisterBodySchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
  role: AccountRoleSchema,
});
export type RegisterBody = z.infer<typeof RegisterBodySchema>;

export const LoginBodySchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1).max(200),
});
export type LoginBody = z.infer<typeof LoginBodySchema>;

export const SelectRoleBodySchema = z.object({ role: AccountRoleSchema });

export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: PasswordSchema,
});

export const AccountDtoSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  accountId: IdSchema,
  username: z.string(),
  role: AccountRoleSchema,
  kind: z.enum(['community', 'simulator']),
});
export type AccountDto = z.infer<typeof AccountDtoSchema>;

export const AuthSessionResponseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  token: z.string(),
  expiresAtMs: EpochMsSchema,
  account: AccountDtoSchema,
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;

