import type { AccountDto, AuthSessionResponse } from '@buskothay/shared';

const KEY = 'buskothay.account';

export interface AccountSession {
  readonly token: string;
  readonly expiresAtMs: number;
  readonly account: AccountDto;
}

export function loadAccountSession(): AccountSession | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AccountSession;
    if (
      typeof parsed.token !== 'string' ||
      typeof parsed.expiresAtMs !== 'number' ||
      parsed.expiresAtMs <= Date.now() ||
      typeof parsed.account?.accountId !== 'string'
    ) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveAccountSession(response: AuthSessionResponse): AccountSession {
  const session: AccountSession = {
    token: response.token,
    expiresAtMs: response.expiresAtMs,
    account: response.account,
  };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // The active page can still use the in-memory result.
  }
  window.dispatchEvent(new Event('buskothay-account-changed'));
  return session;
}

export function clearAccountSession(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // The in-memory caller still clears its state.
  }
  window.dispatchEvent(new Event('buskothay-account-changed'));
}

