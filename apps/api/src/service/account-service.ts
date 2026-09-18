import {
  SCHEMA_VERSION,
  type AccountDto,
  type AccountRole,
  type AuthSessionResponse,
  type Clock,
} from '@buskothay/shared';
import { hashSecret, newId, newToken, secretMatchesHash } from '../auth/capabilities.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { ApiProblem, forbidden, unauthenticated } from '../http/errors.js';
import type { AccountRecord, JourneyRepository } from '../store/types.js';

export interface AccountPrincipal {
  readonly account: AccountRecord;
  readonly sessionTokenHash: string | null;
}

export class AccountService {
  constructor(
    private readonly repo: JourneyRepository,
    private readonly clock: Clock,
    private readonly sessionTtlMs: number,
    private readonly simulatorToken: string | undefined,
  ) {}

  async register(input: {
    username: string;
    password: string;
    role: AccountRole;
  }): Promise<AuthSessionResponse> {
    const nowMs = this.clock.nowMs();
    const username = input.username.trim();
    const account: AccountRecord = {
      accountId: newId('a'),
      username,
      usernameNormalised: normaliseUsername(username),
      passwordHash: await hashPassword(input.password),
      role: input.role,
      kind: 'community',
      authVersion: 1,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    };
    if (!(await this.repo.createAccount(account))) {
      throw new ApiProblem(409, 'USERNAME_TAKEN', 'That username is already in use.');
    }
    return this.issue(account);
  }

  async login(username: string, password: string): Promise<AuthSessionResponse> {
    const account = await this.repo.getAccountByUsername(normaliseUsername(username));
    // Perform a real KDF even for an unknown name so the error does not become a
    // fast username-existence oracle.
    const valid = account
      ? await verifyPassword(password, account.passwordHash)
      : await verifyPassword(password, DUMMY_PASSWORD_HASH);
    if (!account || !valid) {
      throw new ApiProblem(401, 'INVALID_CREDENTIALS', 'The username or password was not accepted.');
    }
    return this.issue(account);
  }

  async authenticate(token: string | null): Promise<AccountPrincipal> {
    if (!token) throw unauthenticated();
    if (this.simulatorToken && secretMatchesHash(token, hashSecret(this.simulatorToken))) {
      const nowMs = this.clock.nowMs();
      return {
        sessionTokenHash: null,
        account: {
          accountId: 'system_simulator',
          username: 'demo-fleet',
          usernameNormalised: 'demo-fleet',
          passwordHash: '',
          role: 'driver',
          kind: 'simulator',
          authVersion: 1,
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
        },
      };
    }
    const tokenHash = hashSecret(token);
    const session = await this.repo.getAccountSession(tokenHash);
    if (!session || session.expiresAtMs <= this.clock.nowMs()) throw unauthenticated();
    const account = await this.repo.getAccountById(session.accountId);
    if (!account || account.authVersion !== session.authVersion) throw unauthenticated();
    return { account, sessionTokenHash: tokenHash };
  }

  async logout(principal: AccountPrincipal): Promise<void> {
    if (principal.sessionTokenHash) await this.repo.deleteAccountSession(principal.sessionTokenHash);
  }

  async selectRole(principal: AccountPrincipal, role: AccountRole): Promise<AuthSessionResponse> {
    if (principal.account.kind !== 'community') throw forbidden();
    const next = {
      ...principal.account,
      role,
      updatedAtMs: this.clock.nowMs(),
    };
    if (!(await this.repo.putAccount(next, principal.account.authVersion))) {
      throw new ApiProblem(409, 'CONFLICT', 'The account changed. Please try again.');
    }
    return this.issue(next);
  }

  async changePassword(
    principal: AccountPrincipal,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthSessionResponse> {
    if (
      principal.account.kind !== 'community' ||
      !(await verifyPassword(currentPassword, principal.account.passwordHash))
    ) {
      throw new ApiProblem(401, 'INVALID_CREDENTIALS', 'The current password was not accepted.');
    }
    const next: AccountRecord = {
      ...principal.account,
      passwordHash: await hashPassword(newPassword),
      authVersion: principal.account.authVersion + 1,
      updatedAtMs: this.clock.nowMs(),
    };
    if (!(await this.repo.putAccount(next, principal.account.authVersion))) {
      throw new ApiProblem(409, 'CONFLICT', 'The account changed. Please try again.');
    }
    return this.issue(next);
  }

  toDto(account: AccountRecord): AccountDto {
    return {
      schemaVersion: SCHEMA_VERSION,
      accountId: account.accountId,
      username: account.username,
      role: account.role,
      kind: account.kind,
    };
  }

  private async issue(account: AccountRecord): Promise<AuthSessionResponse> {
    const token = newToken();
    const nowMs = this.clock.nowMs();
    const expiresAtMs = nowMs + this.sessionTtlMs;
    await this.repo.createAccountSession({
      tokenHash: hashSecret(token),
      accountId: account.accountId,
      authVersion: account.authVersion,
      createdAtMs: nowMs,
      expiresAtMs,
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      token,
      expiresAtMs,
      account: this.toDto(account),
    };
  }
}

export function normaliseUsername(username: string): string {
  return username.trim().toLocaleLowerCase('en-US');
}

// A valid, fixed scrypt result used only to equalise an unknown-user login. It
// corresponds to an unrelated random password and can never authenticate.
const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$MDEyMzQ1Njc4OWFiY2RlZg$P6qDbJtwL3RTwJ9w1yC5hF6dJSS4xQO0Jw8F3g8x4Fk9wMCpcAziVoeKu7zNYHzMIvqngt65O2oK6N5e6YpI8A';

