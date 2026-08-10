import type { AssetsRepository } from 'laikacms/assets';
import { buildAssetsApi } from 'laikacms/assets/api';
import { AuthenticationError, ForbiddenError, Header, NotFoundError, TemplateLiteral as TL, Url } from 'laikacms/core';
import { addTimingJitter } from 'laikacms/crypto';
import type { DocumentsRepository } from 'laikacms/documents';
import { buildJsonApi as buildDocumentsApi } from 'laikacms/documents/api';
import { allowAll, errorToJsonApiMapper, isLaikaError } from 'laikacms/json-api';
import type { StorageRepository } from 'laikacms/storage';
import { buildJsonApi as buildStorageApi } from 'laikacms/storage/api';
import { buildLocksApi } from './locks.js';

export type { Lock, LockOwner, OwnedLock } from './locks.js';

export {
  ADMIN_SCOPE,
  createScopePolicy,
  GRANULAR_SCOPES,
  hasScope,
  isScope,
  normalizeScopes,
  requiredScopeFor,
  WILDCARD_SCOPE,
} from './scopes.js';
export type { GranularScope, Scope, ScopePolicyOptions } from './scopes.js';

// PAT / bearer-resolution seam (implementation in laikacms/auth). Re-exported
// so a api consumer can wire scoped bearers (OAuth session + PAT) into
// authenticateAccessToken from one import, and get user.scopes for the policy
// above. See decap-cms docs/contributing/learnings/dcb-002-authorization-model.
export {
  hasRequiredScope,
  InsufficientScopeError,
  mintPersonalAccessToken,
  requireScope,
  resolveBearer,
} from 'laikacms/auth';
export type {
  AuthContext,
  MintPatDeps,
  MintPatInput,
  MintPatResult,
  PatRecord,
  ResolveBearerDeps,
  SessionVerificationResult,
} from 'laikacms/auth';

import type { Scope } from './scopes.js';

/**
 * CORS configuration for `laikaApi`.
 *
 * Required when the admin UI is served from a different origin than the API
 * (e.g. `npx serve admin/` on :5000 while the API runs on :3000).
 *
 * @example
 * ```ts
 * laikaApi({
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
 * The authenticated principal — its *identity*, nothing more.
 *
 * Authentication (the `authenticate*` callbacks) answers "who is this?" and
 * returns a `User`. Authorization ("what may they do?") is a separate concern,
 * decided entirely by the required {@link LaikaApiOptions.authorize} callback — a
 * `User` carries no access/permission fields itself.
 *
 * Consumers extend this with whatever identity/claim fields their `authorize`
 * callback needs, by declaring the module:
 *
 * @example
 * ```typescript
 * declare module '@laikacms/server/api' {
 *   interface User {
 *     roles: string[];
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
   * The principal's granted scopes (open `resource:action` vocabulary). Read by
   * {@link createScopePolicy}; populate it in `authenticateAccessToken`,
   * typically from the OAuth session's granted scope. Omitted means "no scopes"
   * (the default policy then denies everything except identity-only routes).
   */
  scopes?: Scope[];
}

/** Which sub-API a request targets. */
export type CmsDomain = 'documents' | 'storage' | 'assets' | 'session' | 'locks';

/**
 * The operation a request performs, derived from its HTTP method and action
 * path segment. `publish`/`unpublish` come from the `/publish` `/unpublish`
 * action segments on the documents API; the rest map from the method.
 */
export type CmsOperation = 'read' | 'create' | 'update' | 'delete' | 'publish' | 'unpublish';

/**
 * The argument passed to {@link LaikaApiOptions.authorize}. Carries the principal,
 * the raw {@link Request}, and the request pre-parsed into resource/operation so
 * a tenant policy can decide access without re-parsing the URL itself.
 *
 * The parse is request-level (cheap, one path split). For `create` there is no
 * key in the URL, so `itemId` — and often `collection` — are `undefined`;
 * per-item fidelity on every route is a future, sub-API-threaded concern.
 */
export interface AuthorizeContext {
  /** The authenticated principal (identity) returned by the `authenticate*` callback. */
  user: User;
  /** The raw request — use it for anything the parsed fields below don't cover. */
  request: Request;
  /** Upper-cased HTTP method, e.g. `'GET'`, `'POST'`. */
  method: string;
  /** Which sub-API the request targets. */
  domain: CmsDomain;
  /** The operation, derived from method + action segment. */
  operation: CmsOperation;
  /** First path segment after the domain (the API resource), if present. */
  collection?: string;
  /** The item key/slug — second path segment, URL-decoded — if present. */
  itemId?: string;
}

export interface LaikaApiOptions {
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
  /**
   * The authorization gate — decides whether the authenticated principal may
   * perform this request. Evaluated at the API boundary before the request is
   * dispatched to any sub-API. Return `true` to allow, `false` to reject with
   * `403 Forbidden`. If it throws, the request fails closed (treated as a
   * denial).
   *
   * This is the ONLY place access is decided: authentication returns identity,
   * authorization happens here. The repositories grant any authenticated
   * principal full read+write, so a request that reaches them has already been
   * authorized. There is no implicit default — you must state the policy.
   *
   * The callback receives an {@link AuthorizeContext}: the principal, the raw
   * {@link Request}, and the request pre-parsed into `{ domain, operation,
   * collection?, itemId? }` so a policy can map resource + operation → required
   * permission without re-parsing the URL. Anything the parse doesn't cover is
   * still reachable via `ctx.request`.
   *
   * @example Everything authenticated is allowed:
   * ```ts
   * authorize: () => true,
   * ```
   * @example Read-only principal:
   * ```ts
   * authorize: ctx => ctx.operation === 'read',
   * ```
   * @example Role-based (with `interface User { roles: string[] }` augmented in):
   * ```ts
   * authorize: ctx => {
   *   if (ctx.operation === 'read') return true;
   *   if (ctx.operation === 'delete') return ctx.user.roles.includes('admin');
   *   return ctx.user.roles.includes('editor');
   * },
   * ```
   */
  authorize: (ctx: AuthorizeContext) => boolean | Promise<boolean>;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
  /**
   * Optional CORS configuration. Required when the admin UI is served
   * from a different origin than this API server (common in local development).
   * When omitted, no CORS headers are emitted and OPTIONS preflights return 404.
   */
  cors?: CorsOptions | undefined;
}

export interface LaikaApi {
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

/** Map an HTTP method plus action path segment to a {@link CmsOperation}. */
function deriveOperation(method: string, action: string | undefined): CmsOperation {
  if (action === 'publish') return 'publish';
  if (action === 'unpublish') return 'unpublish';
  switch (method) {
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      // GET / HEAD / OPTIONS and any other non-mutating method.
      return 'read';
  }
}

/**
 * Parse the resource/operation fields of an {@link AuthorizeContext} from the
 * request path *relative to the domain endpoint* (leading slash already
 * stripped). `collection` is the first segment (the API resource), `itemId` the
 * second (the key/slug, URL-decoded), `action` the third (e.g. `publish`).
 */
function parseAuthzTarget(
  method: string,
  domain: CmsDomain,
  domainSubPath: string,
): Pick<AuthorizeContext, 'operation' | 'collection' | 'itemId'> {
  const segments = domainSubPath.split('/').filter(Boolean);
  // /locks keys are a single URL-encoded segment (`collection%2Fslug`), with an
  // optional `/refresh` action. Decode the whole key into `itemId` and expose
  // the collection portion so a policy can allow-list who may take locks.
  if (domain === 'locks') {
    const isRefresh = segments[segments.length - 1] === 'refresh';
    const encoded = (isRefresh ? segments.slice(0, -1) : segments).join('/');
    let key: string | undefined;
    try {
      key = encoded ? decodeURIComponent(encoded) : undefined;
    } catch {
      key = encoded || undefined;
    }
    return { operation: deriveOperation(method, undefined), collection: key?.split('/')[0], itemId: key };
  }
  const collection = segments[0];
  const itemId = segments[1] ? decodeURIComponent(segments[1]) : undefined;
  const action = segments[2];
  // /session is read-only identity — never a mutation regardless of method.
  const operation = domain === 'session' ? 'read' : deriveOperation(method, action);
  return { operation, collection, itemId };
}

export const laikaApi = (options: LaikaApiOptions): LaikaApi => {
  const { documents, storage, assets, authenticateAccessToken, authenticateApiToken, basePath, cors } = options;

  const base = Url.normalize(basePath ?? '');

  const healthEndpoint = TL.url`${base}/health`;
  const storageEndpoint = TL.url`${base}/storage`;
  const documentsEndpoint = TL.url`${base}/documents`;
  const assetsEndpoint = TL.url`${base}/assets`;
  const sessionEndpoint = TL.url`${base}/session`;
  const locksEndpoint = TL.url`${base}/locks`;

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

      // Resolve which sub-API this request targets. A path that matches none
      // serves no data, so it 404s here — before authorization runs and before
      // we try to build a context for it.
      let domain: CmsDomain;
      let domainEndpoint: string;
      if (pathname.startsWith(sessionEndpoint)) {
        domain = 'session';
        domainEndpoint = sessionEndpoint;
      } else if (pathname.startsWith(storageEndpoint)) {
        domain = 'storage';
        domainEndpoint = storageEndpoint;
      } else if (pathname.startsWith(documentsEndpoint)) {
        domain = 'documents';
        domainEndpoint = documentsEndpoint;
      } else if (assets && pathname.startsWith(assetsEndpoint)) {
        domain = 'assets';
        domainEndpoint = assetsEndpoint;
      } else if (pathname.startsWith(locksEndpoint)) {
        domain = 'locks';
        domainEndpoint = locksEndpoint;
      } else {
        options.logger?.debug('Endpoint not found:', pathname);
        return await respond(
          new Response(
            JSON.stringify(errorToJsonApiMapper(new NotFoundError('Endpoint not found'))),
            { status: 404, headers: securityHeaders() },
          ),
        );
      }

      // Authorization gate. Authentication established *who* the principal is;
      // authorize(ctx) decides *what they may do*. It is the only access
      // decision — the repositories grant any authenticated principal full
      // read+write, so a request that gets past here has been explicitly
      // authorized. A thrown callback fails closed.
      const method = request.method.toUpperCase();
      const ctx: AuthorizeContext = {
        user,
        request,
        method,
        domain,
        ...parseAuthzTarget(method, domain, pathname.slice(domainEndpoint.length)),
      };
      let allowed: boolean;
      try {
        allowed = await options.authorize(ctx);
      } catch (e) {
        options.logger?.error(`authorize() threw for principal ${user.id}; denying:`, e);
        allowed = false;
      }
      if (!allowed) {
        options.logger?.warn(
          `Rejecting ${method} ${pathname}: authorize() denied principal ${user.id}.`,
        );
        return await respond(
          new Response(
            JSON.stringify(
              errorToJsonApiMapper(
                new ForbiddenError('This credential is not permitted to perform this action.'),
              ),
            ),
            { status: 403, headers: securityHeaders() },
          ),
        );
      }

      // Dispatch to the resolved sub-API.
      if (domain === 'session') {
        options.logger?.debug('Session endpoint for user:', user.id);

        // Return user data excluding sensitive fields and JSON:API §7.2.2 reserved keys.
        // `id` and `type` must live at the resource level only, not inside `attributes`.
        // `type` isn't declared on the base `User` interface, but consumers can add it
        // via module augmentation, so widen the type here to strip it defensively.
        const { passwordHash: _passwordHash, id: _id, type: _type, ...safeUserData } = user as User & {
          type?: unknown,
        };

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
      } else if (domain === 'storage') {
        // The inner JSON:APIs run `allowAll`: this request already cleared
        // authentication and the `authorize(ctx)` gate above, which is this
        // server's single access decision. Re-deciding it per action here
        // would split the policy across two places.
        const storageApi = buildStorageApi({
          repo: storage,
          basePath: `${base}/storage`,
          logger: options.logger,
          authorize: allowAll,
        });
        return await respond(await storageApi.fetch(request));
      } else if (domain === 'documents') {
        // The inner JSON:APIs run `allowAll`: this request already cleared
        // authentication and the `authorize(ctx)` gate above, which is this
        // server's single access decision. Re-deciding it per action here
        // would split the policy across two places.
        const documentsApi = buildDocumentsApi({
          repo: documents,
          basePath: `${base}/documents`,
          logger: options.logger,
          authorize: allowAll,
        });
        return await respond(await documentsApi.fetch(request));
      } else if (domain === 'assets' && assets) {
        // The inner JSON:APIs run `allowAll`: this request already cleared
        // authentication and the `authorize(ctx)` gate above, which is this
        // server's single access decision. Re-deciding it per action here
        // would split the policy across two places.
        const assetsApi = buildAssetsApi({
          repository: assets,
          basePath: `${base}/assets`,
          logger: options.logger,
          authorize: allowAll,
        });
        return await respond(await assetsApi.fetch(request));
      } else if (domain === 'locks') {
        const locksApi = buildLocksApi({
          documents,
          basePath: `${base}/locks`,
          logger: options.logger,
        });
        // Owner identity is the authenticated principal's, derived here — never
        // trusted from the request body — so a caller can't release/override
        // another user's lock. `email` matches the client's lock-owner id
        // (the Decap fork's `user.login`), so "locked-by-me" detection works.
        return await respond(
          await locksApi.fetch(request, { id: user.email, name: user.name ?? user.email }),
        );
      } else {
        // Unreachable: domain resolution above already guaranteed a served
        // endpoint (and that `assets` is present when domain === 'assets').
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
