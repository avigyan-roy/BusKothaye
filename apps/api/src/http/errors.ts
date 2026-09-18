import type { ErrorCode } from '@buskothay/shared';

/**
 * One error type for the whole API.
 *
 * Handlers throw it, one middleware turns it into the documented JSON shape. The
 * message is written for a person to read; rejected values, stack traces and
 * anything that would reveal whether a token hash exists stay out of it.
 */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: { path: string; reason: string }[],
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiProblem';
  }
}

export const badRequest = (message: string, fields?: { path: string; reason: string }[]) =>
  new ApiProblem(400, 'VALIDATION_FAILED', message, fields);

export const unauthenticated = () =>
  new ApiProblem(
    401,
    'UNAUTHENTICATED',
    'This request needs a capability. Check the Authorization header.',
  );

export const forbidden = () =>
  new ApiProblem(
    403,
    'FORBIDDEN',
    'This capability does not have permission for that action.',
  );

export const routeNotFound = () =>
  new ApiProblem(404, 'ROUTE_NOT_FOUND', 'No route with that ID.');

export const journeyNotFound = () =>
  new ApiProblem(404, 'JOURNEY_NOT_FOUND', 'No journey with that ID.');

export const journeyEnded = () =>
  new ApiProblem(410, 'JOURNEY_ENDED', 'This journey has ended.');

export const tooLarge = () =>
  new ApiProblem(413, 'PAYLOAD_TOO_LARGE', 'That request body is too large.');

export const rateLimited = (retryAfterSeconds: number) =>
  new ApiProblem(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.', undefined, {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });

export const storageUnavailable = () =>
  new ApiProblem(
    503,
    'STORAGE_UNAVAILABLE',
    'The service could not save that just now. Please retry.',
    undefined,
    { 'Retry-After': '1' },
  );
