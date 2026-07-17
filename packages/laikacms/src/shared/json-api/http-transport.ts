import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import type * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import type { HttpMethod } from 'effect/unstable/http/HttpMethod';

import { ErrorCodeToClassMap, InvalidData, type LaikaError } from 'laikacms/core';

/**
 * Build an Effect `HttpClient` backed by a specific `fetch` implementation.
 *
 * This is the composition-root hook for TCP/TLS session reuse: on Node, pass
 * a fetch bound to a tuned undici `Agent`/`Pool` (keep-alive timeout, max
 * connections per origin) and every proxy repository sharing the client
 * reuses those sockets. On Cloudflare Workers the runtime pools connections
 * itself, so the {@link defaultHttpClient} is already optimal there.
 *
 * ```ts
 * import { Agent, fetch as undiciFetch } from 'undici';
 *
 * const dispatcher = new Agent({ keepAliveTimeout: 30_000, connections: 128 });
 * const httpClient = httpClientFromFetch(
 *   (input, init) => undiciFetch(input, { ...init, dispatcher }),
 * );
 * ```
 *
 * Clients built from `@effect/platform-node`'s `NodeHttpClient` layers can be
 * passed anywhere this one can; repositories only depend on the
 * `HttpClient.HttpClient` interface.
 */
export const httpClientFromFetch = (
  fetchImpl: typeof globalThis.fetch,
): HttpClient.HttpClient =>
  Effect.service(HttpClient.HttpClient).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetchImpl),
    Effect.runSync,
  );

let cachedDefaultHttpClient: HttpClient.HttpClient | undefined;

/**
 * Process-wide default `HttpClient`, backed by `globalThis.fetch` resolved at
 * request time (not captured at module load), so test-time fetch stubs and
 * late polyfills are honored.
 */
export const defaultHttpClient =
  (): HttpClient.HttpClient => (cachedDefaultHttpClient ??= httpClientFromFetch((input, init) =>
    globalThis.fetch(input, init)
  ));

export interface JsonApiRequestInit {
  method: string;
  /** JSON:API document body — serialized with `application/vnd.api+json`. */
  body?: unknown;
  /** Multipart upload body — mutually exclusive with `body`; the runtime sets the boundary header. */
  multipart?: FormData;
}

export interface JsonApiHttpTransportConfig {
  baseUrl: string;
  authToken?: string;
  /** Dynamic token provider — called before each request. */
  tokenPromise?: () => Promise<string>;
  /**
   * Effect `HttpClient` used for every request. Provide one client per
   * process (built via {@link httpClientFromFetch} or an
   * `@effect/platform-node` layer) so all repositories share a single
   * connection pool. Defaults to {@link defaultHttpClient}.
   */
  httpClient?: HttpClient.HttpClient;
  /**
   * Maps transport-level failures (DNS, refused/reset connections) to the
   * repository's fatal error type. Defaults to
   * `new InvalidData('Network error: …')`.
   */
  networkError?: (message: string) => LaikaError;
}

/**
 * HTTP transport shared by the JSON:API proxy repositories: owns the base
 * URL, auth headers, and the Effect `HttpClient`, and centralizes JSON:API
 * response decoding (content-type validation, `errors[]` → typed
 * `LaikaError` rehydration).
 */
export class JsonApiHttpTransport {
  private readonly baseUrl: string;
  private readonly staticHeaders: Record<string, string>;
  private readonly tokenPromise?: () => Promise<string>;
  private readonly httpClient: HttpClient.HttpClient;
  private readonly networkError: (message: string) => LaikaError;

  constructor(config: JsonApiHttpTransportConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.tokenPromise = config.tokenPromise;
    this.httpClient = config.httpClient ?? defaultHttpClient();
    this.networkError = config.networkError ?? (message => new InvalidData(`Network error: ${message}`));
    this.staticHeaders = {
      'Content-Type': 'application/vnd.api+json',
      'Accept': 'application/vnd.api+json',
      ...(config.authToken ? { 'Authorization': `Bearer ${config.authToken}` } : {}),
    };
  }

  /** Per-request headers — refreshes the bearer token when a provider is configured. */
  private headers(): Effect.Effect<Record<string, string>> {
    if (this.tokenPromise) {
      return Effect.map(
        Effect.promise(() => this.tokenPromise!()),
        token => ({ ...this.staticHeaders, 'Authorization': `Bearer ${token}` }),
      );
    }
    return Effect.succeed(this.staticHeaders);
  }

  /**
   * Execute a request and return the raw response. Transport failures are
   * mapped through `networkError`; HTTP error statuses are NOT failures here
   * — JSON:API error documents are decoded by {@link fetchJson}.
   */
  request(
    path: string,
    init: JsonApiRequestInit = { method: 'GET' },
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const headers = yield* this.headers();
      let request = HttpClientRequest.make(init.method as HttpMethod)(`${this.baseUrl}${path}`)
        .pipe(HttpClientRequest.setHeaders(headers));
      if (init.multipart) {
        // FormData bodies drop the JSON:API content-type; the runtime sets
        // the multipart boundary header itself.
        request = HttpClientRequest.bodyFormData(request, init.multipart);
      } else if (init.body !== undefined) {
        request = HttpClientRequest.bodyText(
          request,
          JSON.stringify(init.body),
          'application/vnd.api+json',
        );
      }
      // Trace-context propagation injects `b3`/`traceparent` headers into
      // every request. Browsers then fail the CORS preflight against any API
      // that doesn't explicitly allow those headers, surfacing as an opaque
      // "Failed to fetch". This transport talks cross-origin by design, so
      // propagation is off; re-enable it at the composition root only when
      // the target API allowlists the tracing headers.
      return yield* Effect.mapError(
        Effect.provideService(
          this.httpClient.execute(request),
          HttpClient.TracerPropagationEnabled,
          false,
        ),
        e => this.networkError(e.message),
      );
    });
  }

  /**
   * Execute a request and decode the JSON:API document: validates the
   * content-type, surfaces non-JSON bodies (typically upstream stack traces)
   * in the failure message, and turns `errors[]` into a fatal `LaikaError`.
   */
  fetchJson(
    path: string,
    init: JsonApiRequestInit = { method: 'GET' },
    opts?: {
      /**
       * Re-hydrate the upstream error's typed LaikaError subclass from its
       * `code` field (falling back to InvalidData) so consumers can
       * `instanceof`-check (e.g. NotFoundError).
       */
      rehydrateErrorCodes?: boolean,
    },
  ): Effect.Effect<{ data?: unknown, errors?: unknown[] } & Record<string, unknown>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const response = yield* this.request(path, init);
      const contentType = response.headers['content-type'];
      const isJson = contentType?.includes('application/vnd.api+json')
        || contentType?.includes('application/json');
      if (!isJson) {
        const bodyResult = yield* Effect.result(Effect.map(response.text, t => t.slice(0, 500)));
        const bodySnippet = bodyResult._tag === 'Success' ? bodyResult.success : '<unreadable>';
        return yield* Effect.fail(
          new InvalidData(
            `${init.method} ${path} → ${response.status} `
              + `(content-type: ${contentType ?? 'none'}): ${bodySnippet}`,
          ),
        );
      }
      const json = yield* Effect.mapError(
        response.json as Effect.Effect<Record<string, unknown>, { message: string }>,
        e => new InvalidData(`${init.method} ${path} → invalid JSON: ${e.message}`),
      );
      const ok = response.status >= 200 && response.status < 300;
      if (!ok || (Array.isArray(json.errors) && json.errors.length > 0)) {
        const errors = (Array.isArray(json.errors) ? json.errors : [{ detail: 'Unknown error' }]) as Array<
          { detail?: string, title?: string, code?: string }
        >;
        const detail = errors.map(e => e.detail || e.title || 'Unknown error').join(', ');
        if (opts?.rehydrateErrorCodes) {
          const firstCode = errors[0]?.code;
          const ErrorCtor = firstCode
            ? (ErrorCodeToClassMap as Record<string, new(msg: string) => LaikaError>)[firstCode]
            : undefined;
          return yield* Effect.fail(ErrorCtor ? new ErrorCtor(detail) : new InvalidData(detail));
        }
        return yield* Effect.fail(new InvalidData(detail));
      }
      return json as { data?: unknown, errors?: unknown[] } & Record<string, unknown>;
    });
  }
}
