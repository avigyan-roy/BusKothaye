import type {
  CreateJourneyResponse,
  BoardJourneyResponse,
  AccountDto,
  AccountRole,
  AuthSessionResponse,
  DemoControlDto,
  DemoFleetConfig,
  DebugDto,
  JoinJourneyResponse,
  JourneyListResponse,
  JourneyStateDto,
  LocationReport,
  LocationResponse,
  RouteDto,
  RouteListResponse,
} from '@buskothay/shared';
import { loadWebConfig } from '../config/site.js';

/**
 * Every call to the API goes through this module.
 *
 * It exists so that timeouts, abort handling and the error shape are decided once
 * rather than in each component, and so that no component ever builds a URL that
 * could accidentally carry a capability. Capabilities go in the Authorization
 * header only.
 */

export const webConfig = loadWebConfig(
  import.meta.env as unknown as Parameters<typeof loadWebConfig>[0],
);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A network failure, a timeout or an abort — not an answer from the server. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  readonly token?: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly idempotencyKey?: string;
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 8000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(`${webConfig.apiBaseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
        ...(options.idempotencyKey === undefined
          ? {}
          : { 'idempotency-key': options.idempotencyKey }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    const text = await response.text();
    if (!response.ok) {
      let code = 'UNKNOWN';
      let message = 'The server could not complete that request.';
      try {
        const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
        code = parsed.error?.code ?? code;
        message = parsed.error?.message ?? message;
      } catch {
        // A non-JSON error body is not shown to the person; the status carries it.
      }
      const retryAfter = response.headers.get('Retry-After');
      throw new ApiError(
        response.status,
        code,
        message,
        retryAfter === null ? null : Number(retryAfter),
      );
    }
    return text.length === 0 ? (undefined as T) : (JSON.parse(text) as T);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new NetworkError('The request was cancelled or timed out.');
    }
    throw new NetworkError('Could not reach the server.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export const api = {
  getRoute: (routeId: string, signal?: AbortSignal) =>
    request<RouteDto>('GET', `/v1/routes/${encodeURIComponent(routeId)}`, { signal }),

  listJourneys: (routeId: string, signal?: AbortSignal) =>
    request<JourneyListResponse>(
      'GET',
      `/v1/routes/${encodeURIComponent(routeId)}/journeys`,
      { signal, timeoutMs: 5000 },
    ),

  getState: (journeyId: string, signal?: AbortSignal) =>
    request<JourneyStateDto>('GET', `/v1/journeys/${encodeURIComponent(journeyId)}/state`, {
      signal,
      // Shorter than the poll interval's tolerance: a request that has not
      // answered in three seconds is not going to help the next second's update.
      timeoutMs: 4000,
    }),

  listRoutes: (signal?: AbortSignal) =>
    request<RouteListResponse>('GET', '/v1/routes', { signal }),

  register: (username: string, password: string, role: AccountRole) =>
    request<AuthSessionResponse>('POST', '/v1/auth/register', {
      body: { username, password, role },
    }),

  login: (username: string, password: string) =>
    request<AuthSessionResponse>('POST', '/v1/auth/login', {
      body: { username, password },
    }),

  getAccount: (token: string) =>
    request<AccountDto>('GET', '/v1/auth/me', { token }),

  selectRole: (token: string, role: AccountRole) =>
    request<AuthSessionResponse>('PUT', '/v1/auth/role', { token, body: { role } }),

  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<AuthSessionResponse>('PUT', '/v1/auth/password', {
      token,
      body: { currentPassword, newPassword },
    }),

  logout: (token: string) => request<void>('POST', '/v1/auth/logout', { token }),

  createJourney: (routeId: string, idempotencyKey: string, accountToken: string) =>
    request<CreateJourneyResponse>('POST', '/v1/journeys', {
      token: accountToken,
      body: { routeId },
      idempotencyKey,
    }),

  joinJourney: (
    journeyId: string,
    joinCode: string,
    role: 'passenger' | 'conductor',
    idempotencyKey: string,
    accountToken: string,
  ) =>
    request<JoinJourneyResponse>(
      'POST',
      `/v1/journeys/${encodeURIComponent(journeyId)}/contributors`,
      { token: accountToken, body: { joinCode, role }, idempotencyKey },
    ),

  boardJourney: (
    journeyId: string,
    stopId: string,
    idempotencyKey: string,
    accountToken: string,
  ) =>
    request<BoardJourneyResponse>(
      'POST',
      `/v1/journeys/${encodeURIComponent(journeyId)}/board`,
      { token: accountToken, body: { stopId }, idempotencyKey },
    ),

  sendLocations: (
    journeyId: string,
    token: string,
    reports: readonly LocationReport[],
    signal?: AbortSignal,
  ) =>
    request<LocationResponse>(
      'POST',
      `/v1/journeys/${encodeURIComponent(journeyId)}/locations`,
      {
        token,
        signal,
        body: reports.length === 1 ? reports[0] : { updates: reports },
      },
    ),

  revokeSelf: (journeyId: string, token: string) =>
    request<unknown>(
      'DELETE',
      `/v1/journeys/${encodeURIComponent(journeyId)}/contributors/me`,
      { token },
    ),

  endJourney: (journeyId: string, accountToken: string) =>
    request<unknown>('POST', `/v1/journeys/${encodeURIComponent(journeyId)}/end`, {
      token: accountToken,
    }),

  getDebug: (journeyId: string, token: string, signal?: AbortSignal) =>
    request<DebugDto>('GET', `/v1/journeys/${encodeURIComponent(journeyId)}/debug`, {
      token,
      signal,
      timeoutMs: 5000,
    }),

  getDemoControl: (accountToken: string, signal?: AbortSignal) =>
    request<DemoControlDto>('GET', '/v1/demo', { token: accountToken, signal }),

  switchDemo: (
    accountToken: string,
    enabled: boolean,
    config?: Partial<DemoFleetConfig>,
  ) =>
    request<DemoControlDto>('PUT', '/v1/demo', {
      token: accountToken,
      body: { enabled, ...(config ? { config } : {}) },
    }),

  updateDemo: (accountToken: string, config: Partial<DemoFleetConfig>) =>
    request<DemoControlDto>('PATCH', '/v1/demo', { token: accountToken, body: config }),

  resetDemo: (accountToken: string) =>
    request<DemoControlDto>('POST', '/v1/demo/reset', { token: accountToken }),
};
