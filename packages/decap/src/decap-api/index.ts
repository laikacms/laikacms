import type { AssetsRepository } from 'laikacms/assets';
import { buildAssetsApi } from 'laikacms/assets/api';
import { AuthenticationError, ForbiddenError, Header, NotFoundError, TemplateLiteral as TL, Url } from 'laikacms/core';
import { addTimingJitter } from 'laikacms/crypto';
import type { DocumentsRepository } from 'laikacms/documents';
import { buildJsonApi as buildDocumentsApi } from 'laikacms/documents/api';
import { errorToJsonApiMapper, isLaikaError } from 'laikacms/json-api';
import type { StorageRepository } from 'laikacms/storage';
import { buildJsonApi as buildStorageApi } from 'laikacms/storage/api';

/**
 * CORS configuration for `decapApi`.
 *
 * Required when the Decap admin is served from a different origin than the API
 * (e.g. `npx serve admin/` on :5000 while the API runs on :3000).
 *
 * @example
 * ```ts
 * decapApi({
 *   // …
 *   cors: { origins: ['http://localhost:5000'] },
 * });
 * ```
 *
 * Use `origins: '*'` to allow any origin (convenient for local dev, not for production):
 * ```ts
 * cors: { origins: '*' }
 * ```
 */
export interface CorsOptions {
  /**
   * Allowed origins. Either an explicit list of origin strings
   * (e.g. `['http://localhost:5000', 'https://admin.example.com']`)
   * or the string `'*'` to allow any origin.
   */
  origins: string[] | '*';
  /**
   * Preflight cache lifetime in seconds sent via `Access-Control-Max-Age`.
   * Defaults to `86400` (24 h).
   */
  maxAge?: number;
}

/**
 * Security constants for the API
 * These can be used by consumers to configure their implementations
 */
export const SECURITY_DEFAULTS = {
  /** Maximum length for access tokens in requests */
  MAX_TOKEN_LENGTH: 2048,
  /** Maximum length for API keys */
  MAX_API_KEY_LENGTH: 512,
  /** Minimum token entropy bits for post-quantum security */
  MIN_TOKEN_ENTROPY_BITS: 256,
} as const;

/**
 * Default user interface with required fields.
 * Consumers can extend this by declaring the module:
 *
 * @example
 * ```typescript
 * declare module '@laikacms/decap/decap-api' {
 *   interface User {
 *     role: 'admin' | 'editor';
 *     organizationId: string;
 *   }
 * }
 * ```
 */
export interface User {
  id: string;
  email: string;
  name?: string;
  passwordHash?: string;
  /**
   * Optional access scope for the authenticated principal.
   *
   * When explicitly `'read'`, the principal may only perform SAFE (non-mutating)
   * requests — any other method is rejected with 403 at the API boundary (see
   * {@link decapApi}). This lets consumers wire a read-only credential (e.g. a
   * read-only API key) even though the underlying repositories grant every
   * authenticated principal full read+write.
   *
   * Left unset (or `'write'`) the principal keeps full access, so this is
   * backwards compatible for consumers that don't populate it.
   */
  scope?: 'read' | 'write';
}

/**
 * HTTP methods that never mutate state. A read-only principal is allowed these;
 * everything else requires write scope.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface DecapOptions {
  documents: DocumentsRepository;
  storage: StorageRepository;
  /**
   * Optional assets repository for binary file storage (images, videos, etc.)
   * If provided, an /assets endpoint will be available using the assets-api.
   */
  assets?: AssetsRepository;
  basePath?: string | undefined;
  /**
   * Authenticate a Bearer access token and return the user.
   * This is the primary authentication method for API requests.
   */
  authenticateAccessToken: (rawToken: string) => Promise<User>;
  /**
   * Optional: Authenticate an API key and return the user.
   * API keys can be passed via X-API-Key header or Authorization: ApiKey <key>
   */
  authenticateApiToken?: (token: string) => Promise<User>;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
  /**
   * Optional CORS configuration. Required when the Decap admin UI is served
   * from a different origin than this API server (common in local development).
   * When omitted, no CORS headers are emitted and OPTIONS preflights return 404.
   */
  cors?: CorsOptions | undefined;
}

export interface DecapApi {
  fetch(request: Request): Promise<Response>;
  authenticateRequest(request: Request): Promise<Response | User>;
}

/**
 * Validate token input length to prevent DoS attacks
 */
function validateTokenInput(token: string | null | undefined): string | null {
  if (!token || typeof token !== 'string') {
    return null;
  }
  if (token.length > SECURITY_DEFAULTS.MAX_TOKEN_LENGTH) {
    return null;
  }
  return token;
}

/**
 * Return CORS headers for `origin` if the origin is permitted by `corsOptions`,
 * or `null` if CORS is unconfigured or the origin is not allowed.
 */
function resolveCorsHeaders(
  origin: string | null,
  corsOptions: CorsOptions | undefined,
): Record<string, string> | null {
  if (!corsOptions || !origin) return null;
  const allowed = corsOptions.origins === '*'
    || (corsOptions.origins as string[]).includes(origin);
  if (!allowed) return null;
  const allowOrigin = corsOptions.origins === '*' ? '*' : origin;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-API-Key',
    'Access-Control-Max-Age': String(corsOptions.maxAge ?? 86400),
    ...(corsOptions.origins !== '*' ? { Vary: 'Origin' } : {}),
  };
}

/**
 * Clone a Response and merge extra headers into it.
 *
 * We buffer via arrayBuffer() rather than forwarding response.body (a ReadableStream)
 * because passing a stream to new Response() produces Transfer-Encoding: chunked — the
 * Content-Length from the original headers is ignored by Node's HTTP layer, and Chromium
 * aborts cross-origin requests with ERR_CONTENT_LENGTH_MISMATCH. Buffering preserves the
 * known length and keeps the response non-chunked.
 */
async function withHeaders(response: Response, extra: Record<string, string>): Promise<Response> {
  const merged = new Headers(response.headers);
  for (const [k, v] of Object.entries(extra)) merged.set(k, v);
  // A null-body status (204/304/…) rejects *any* body, including a zero-length
  // buffer — so the body has to stay null rather than becoming an empty ArrayBuffer.
  const body = response.body === null ? null : await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

// Factory — never hand out a shared mutable object to new Response() because
// @hono/node-server's responseViaCache mutates the headers in-place (LCMS-440).
const securityHeaders = () => ({
  'Content-Type': 'application/vnd.api+json',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
});

export const decapApi = (options: DecapOptions): DecapApi => {
  const { documents, storage, assets, authenticateAccessToken, authenticateApiToken, basePath, cors } = options;

  const base = Url.normalize(basePath ?? '');

  const healthEndpoint = TL.url`${base}/health`;
  const storageEndpoint = TL.url`${base}/storage`;
  const documentsEndpoint = TL.url`${base}/documents`;
  const assetsEndpoint = TL.url`${base}/assets`;
  const sessionEndpoint = TL.url`${base}/session`;

  const authenticateRequest = async (request: Request): Promise<Response | User> => {
    const authHeader = request.headers.get('Authorization') || undefined;
    const apiKeyHeader = request.headers.get('X-API-Key') || undefined;
    const apiKeyAuth = authHeader ? Header.ExtractAuthorizationApiKey(authHeader) : undefined;

    // Bearer credentials must never be accepted via URL query strings
    // (RFC 6750 §2.3, OWASP API Security): they leak through server logs,
    // CDN logs, browser history, and the Referer header. If a caller still
    // sends `?api_key=…`, reject the entire request immediately — do not fall
    // through to Bearer auth, as that would allow credentials in URLs to
    // silently succeed when paired with a valid Authorization header.
    if (new URL(request.url).searchParams.has('api_key')) {
      options.logger?.warn(
        'Rejecting api_key supplied via URL query string. Use the X-API-Key header or '
          + 'Authorization: ApiKey <key>.',
      );
      await addTimingJitter();
      return new Response(
        JSON.stringify(
          errorToJsonApiMapper(
            new AuthenticationError(
              'api_key supplied as a URL query parameter is not accepted. '
                + 'Use the X-API-Key header or Authorization: ApiKey <key>.',
            ),
          ),
        ),
        { status: 401, headers: securityHeaders() },
      );
    }

    try {
      // Validate and extract API key with length limits
      const rawApiKey = apiKeyHeader || apiKeyAuth;
      const apiKey = rawApiKey ? validateTokenInput(rawApiKey) : null;

      if (rawApiKey && !apiKey) {
        // API key was provided but failed validation
        throw new AuthenticationError('Invalid API key format');
      }

      if (apiKey) {
        // If an API key is provided, only try API key authentication
        if (!authenticateApiToken) {
          options.logger?.error('API key authentication not configured');
          throw new AuthenticationError('API key authentication not configured');
        }
        return await authenticateApiToken(apiKey);
      } else {
        // Regular Bearer token authentication
        const rawToken = Header.ExtractAuthorizationBearerToken(authHeader);
        const token = validateTokenInput(rawToken);

        if (!token) {
          throw new AuthenticationError('Invalid or missing authentication token');
        }

        // Authenticate the token
        return await authenticateAccessToken(token);
      }
    } catch (e) {
      options.logger?.error('Authentication failed:', e);
      const error = isLaikaError(e) ? e : new AuthenticationError('Authentication failed');
      await addTimingJitter();
      return new Response(
        JSON.stringify(errorToJsonApiMapper(error)),
        { status: 401, headers: securityHeaders() },
      );
    }
  };

  return {
    authenticateRequest,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const pathname = Url.normalize(url.pathname);
      const origin = request.headers.get('Origin');
      const corsHeaders = resolveCorsHeaders(origin, cors);

      // CORS preflight — must be answered before any auth check.
      // Browsers send OPTIONS with no credentials; running it through the auth
      // path would return 401 and the browser would never issue the real request.
      if (request.method === 'OPTIONS' && corsHeaders) {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Helper: attach CORS headers to every outgoing response when configured.
      const respond = (res: Response): Promise<Response> =>
        corsHeaders ? withHeaders(res, corsHeaders) : Promise.resolve(res);

      // Health endpoint (no authentication required)
      if (pathname === healthEndpoint) {
        options.logger?.debug('Health check endpoint');
        return await respond(
          new Response(
            JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
            { status: 200, headers: { ...securityHeaders(), 'Content-Type': 'application/json' } },
          ),
        );
      }

      // All other endpoints require authentication
      const authenticated = await authenticateRequest(request);
      if (authenticated instanceof Response) {
        return await respond(authenticated);
      }
      const user = authenticated;

      // Scope enforcement (defence in depth). A principal whose scope is
      // explicitly `'read'` may only issue SAFE requests. The repositories
      // themselves grant any authenticated principal full read+write, so a
      // read-only credential can ONLY be honoured here, at the boundary, before
      // the request reaches a sub-API. Unset/`'write'` scope keeps full access.
      if (user.scope === 'read' && !SAFE_METHODS.has(request.method.toUpperCase())) {
        options.logger?.warn(
          `Rejecting ${request.method} ${pathname}: read-only principal ${user.id} may not mutate.`,
        );
        return await respond(
          new Response(
            JSON.stringify(
              errorToJsonApiMapper(
                new ForbiddenError('This credential is not permitted to perform write operations.'),
              ),
            ),
            { status: 403, headers: securityHeaders() },
          ),
        );
      }

      if (pathname.startsWith(sessionEndpoint)) {
        options.logger?.debug('Session endpoint for user:', user.id);

        // Return user data excluding sensitive fields and JSON:API §7.2.2 reserved keys.
        // `id` must live at the resource level only, not inside `attributes`.
        const { passwordHash: _passwordHash, id: _id, ...safeUserData } = user;

        return await respond(
          new Response(
            JSON.stringify({
              data: {
                type: 'session',
                id: user.id || user.email,
                attributes: {
                  ...safeUserData,
                },
              },
            }),
            { status: 200, headers: { ...securityHeaders(), 'Content-Type': 'application/json' } },
          ),
        );
      } else if (pathname.startsWith(storageEndpoint)) {
        const storageApi = buildStorageApi({ repo: storage, basePath: `${base}/storage`, logger: options.logger });
        return await respond(await storageApi.fetch(request));
      } else if (pathname.startsWith(documentsEndpoint)) {
        const documentsApi = buildDocumentsApi({
          repo: documents,
          basePath: `${base}/documents`,
          logger: options.logger,
        });
        return await respond(await documentsApi.fetch(request));
      } else if (assets && pathname.startsWith(assetsEndpoint)) {
        const assetsApi = buildAssetsApi({ repository: assets, basePath: `${base}/assets`, logger: options.logger });
        return await respond(await assetsApi.fetch(request));
      } else {
        options.logger?.debug('Endpoint not found:', pathname);
        return await respond(
          new Response(
            JSON.stringify(errorToJsonApiMapper(new NotFoundError('Endpoint not found'))),
            { status: 404, headers: securityHeaders() },
          ),
        );
      }
    },
  };
};
