import type {
  CreateJourneyResponse,
  DemoControlDto,
  DebugDto,
  JourneyStateDto,
  LocationReport,
  LocationResponse,
  RouteDto,
} from '@buskothay/shared';

/**
 * The simulator's HTTP client.
 *
 * It uses exactly the endpoints a real phone uses, with no privileged test route
 * and no way to hand the server ground truth. If the simulator can drive a
 * journey, so can a contributor's browser.
 */
export class SimulatorApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SimulatorApiError';
  }
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string | undefined = undefined,
  ) {}

  async getRoute(routeId: string): Promise<RouteDto> {
    return this.request<RouteDto>('GET', `/v1/routes/${routeId}`);
  }

  async createJourney(routeId: string): Promise<CreateJourneyResponse> {
    return this.request<CreateJourneyResponse>('POST', '/v1/journeys', {
      token: this.requireServiceToken(),
      body: { routeId },
      idempotencyKey: crypto.randomUUID(),
    });
  }

  async join(
    journeyId: string,
    joinCode: string,
    role: 'conductor' | 'passenger',
  ): Promise<{ contributorId: string; contributorToken: string }> {
    return this.request('POST', `/v1/journeys/${journeyId}/contributors`, {
      token: this.requireServiceToken(),
      body: { joinCode, role },
      idempotencyKey: crypto.randomUUID(),
    });
  }

  async report(
    journeyId: string,
    token: string,
    reports: readonly LocationReport[],
  ): Promise<LocationResponse> {
    return this.request<LocationResponse>('POST', `/v1/journeys/${journeyId}/locations`, {
      token,
      body: reports.length === 1 ? reports[0] : { updates: reports },
    });
  }

  async state(journeyId: string): Promise<JourneyStateDto> {
    return this.request<JourneyStateDto>('GET', `/v1/journeys/${journeyId}/state`);
  }

  async debug(journeyId: string, opsToken: string): Promise<DebugDto> {
    return this.request<DebugDto>('GET', `/v1/journeys/${journeyId}/debug`, {
      token: opsToken,
    });
  }

  async end(journeyId: string): Promise<void> {
    await this.request('POST', `/v1/journeys/${journeyId}/end`, {
      token: this.requireServiceToken(),
    });
  }

  async demoControl(): Promise<DemoControlDto> {
    return this.request<DemoControlDto>('GET', '/v1/demo/worker/control', {
      token: this.requireServiceToken(),
    });
  }

  async acquireDemoLease(ownerId: string, generation: number): Promise<{ acquired: boolean; generation: number; expiresAtMs: number }> {
    return this.request('POST', '/v1/demo/worker/lease', {
      token: this.requireServiceToken(),
      body: { ownerId, generation },
    });
  }

  private async request<T>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
          ...(options.idempotencyKey === undefined
            ? {}
            : { 'idempotency-key': options.idempotencyKey }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (cause) {
      // "fetch failed" on its own tells nobody anything. Name the address and the
      // most likely reason.
      throw new SimulatorApiError(
        0,
        'UNREACHABLE',
        `Could not reach the API at ${this.baseUrl}. Is it running? ` +
          "Start it with `npm run dev` (or `npm run start -w @buskothay/api`), then check " +
          `${this.baseUrl}/health responds.`,
        { cause },
      );
    }

    const text = await response.text();
    if (!response.ok) {
      let code = 'UNKNOWN';
      let message = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
        code = parsed.error?.code ?? code;
        message = parsed.error?.message ?? message;
      } catch {
        // Leave the raw text; a non-JSON error is itself worth seeing.
      }
      throw new SimulatorApiError(response.status, code, `${method} ${path}: ${message}`);
    }
    return text.length === 0 ? (undefined as T) : (JSON.parse(text) as T);
  }

  private requireServiceToken(): string {
    if (this.serviceToken) return this.serviceToken;
    throw new SimulatorApiError(
      0,
      'SIMULATOR_TOKEN_MISSING',
      'Set SIMULATOR_TOKEN to the same private value configured on the API.',
    );
  }
}
