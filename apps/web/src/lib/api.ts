import type {
  CreateJourneyResponse,
  DebugDto,
  JoinJourneyResponse,
  JourneyListResponse,
  JourneyStateDto,
  LocationReport,
  LocationResponse,
  RouteDto,
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

  createJourney: (routeId: string, idempotencyKey: string) =>
    request<CreateJourneyResponse>('POST', '/v1/journeys', {
      body: { routeId, isDemo: false },
      idempotencyKey,
    }),

  joinJourney: (
    journeyId: string,
    joinCode: string,
    role: 'passenger' | 'conductor',
    idempotencyKey: string,
  ) =>
    request<JoinJourneyResponse>(
      'POST',
      `/v1/journeys/${encodeURIComponent(journeyId)}/contributors`,
      { body: { joinCode, role }, idempotencyKey },
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

  endJourney: (journeyId: string, token: string) =>
    request<unknown>('POST', `/v1/journeys/${encodeURIComponent(journeyId)}/end`, { token }),

  getDebug: (journeyId: string, token: string, signal?: AbortSignal) =>
    request<DebugDto>('GET', `/v1/journeys/${encodeURIComponent(journeyId)}/debug`, {
      token,
      signal,
      timeoutMs: 5000,
    }),
};
