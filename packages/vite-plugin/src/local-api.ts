/**
 * Local mode — mount LaikaCMS's own JSON:API over the dev server.
 *
 * While `vite dev` is running, {@link mountLocalApi} exposes the plugin's own
 * `storage`/`documents`/`assets` repositories through the same JSON:API contract the
 * Decap laika-backend already speaks, so a JSON:API client (the Decap admin,
 * or any other) can read and write content locally instead of a remote
 * backend. Unauthenticated by design — see the module-level warning below —
 * and reachable only through the dev server, because {@link mountLocalApi} is
 * only ever called from `configureServer`; nothing in the `build` phase or
 * `configurePreviewServer` calls it, so a production build has no route to
 * it by construction.
 *
 * `${basePath}/session` is a trivial, unauthenticated stub-identity responder,
 * not a repository-backed sub-API: `LaikaBackend.authenticate()`
 * (`@laikacms/decap`) always pings it to resolve a display identity, even
 * when `resolveLaikaBackend`'s local backend authenticates with a dummy
 * token, so it must exist for the local backend to complete login (LCMS-449
 * slice 2, issue #848).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { buildAssetsApi } from 'laikacms/assets-api';
import { buildJsonApi as buildDocumentsJsonApi } from 'laikacms/documents-api';
import { buildJsonApi as buildStorageJsonApi } from 'laikacms/storage-api';

import type { LaikaRepositories } from './backend.js';

/** Default base path both local-mode sub-APIs mount under. */
export const DEFAULT_LOCAL_API_BASE_PATH = '/__laika';

export interface LaikaLocalApiOptions {
  /**
   * Base path the `storage`/`documents`/`assets` sub-routes mount under.
   * Defaults to {@link DEFAULT_LOCAL_API_BASE_PATH}.
   */
  basePath?: string;
}

/** A Node HTTP request handler compatible with Connect/Vite's `middlewares.use`. */
export type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/** The subset of Connect's `Server` this module needs. */
export interface LocalApiMiddlewares {
  use(route: string, handler: ConnectMiddleware): unknown;
}

/**
 * The subset of a Vite `ViteDevServer` {@link mountLocalApi} needs. A real dev
 * server is structurally assignable, so callers pass their `ViteDevServer`
 * directly.
 */
export interface LocalApiServer {
  middlewares: LocalApiMiddlewares;
  config: {
    server: { host?: string | boolean | undefined },
    logger?: { warn(msg: string): void } | undefined,
  };
}

/** Loopback / unset hosts never leave the machine; anything else does. */
function isLoopbackHost(host: string | boolean | undefined): boolean {
  if (host === undefined || host === false) return true;
  if (host === true) return false;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** Convert a Node request into a Fetch `Request` against the dev server's own origin. */
function toFetchRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? 'localhost';
  // Connect strips the matched mount route from `req.url` before dispatching,
  // but the sub-APIs route on the full path (they are built with a basePath).
  // `originalUrl` is Connect's unstripped copy; plain Node servers don't set it.
  const originalUrl = (req as IncomingMessage & { originalUrl?: string }).originalUrl;
  const url = new URL(originalUrl ?? req.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  const method = req.method ?? 'GET';
  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(req) as unknown as BodyInit;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

/** Stream a Fetch `Response` back through a Node `ServerResponse`. */
async function writeFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

/**
 * The dummy identity local mode reports at `${basePath}/session`. Local mode
 * performs no real auth (see the module doc), so this is a fixed stub, not a
 * lookup — every request gets the same response.
 */
const LOCAL_SESSION_USER = { name: 'Local Dev', email: 'local-dev@laikacms.local' };

/**
 * A trivial `${basePath}/session` responder. `resolveLaikaBackend`'s local
 * backend (`@laikacms/decap`) authenticates with a dummy token and never
 * performs the PKCE OAuth dance, but `LaikaBackend.authenticate()` always
 * pings `${apiUrl}/session` to resolve the display identity regardless of how
 * the token was obtained — local mode has no real session to report, so this
 * always succeeds with the same stub identity. Matches the JSON:API shape
 * `decap-api`'s own `/session` endpoint returns.
 */
async function sessionHandler(_request: Request): Promise<Response> {
  return new Response(
    JSON.stringify({
      data: {
        type: 'session',
        id: LOCAL_SESSION_USER.email,
        attributes: LOCAL_SESSION_USER,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Adapt a `fetch(Request) => Promise<Response>` handler to a Connect middleware. */
function toConnectMiddleware(fetchHandler: (request: Request) => Promise<Response>): ConnectMiddleware {
  return (req, res, next) => {
    void (async () => {
      try {
        const request = toFetchRequest(req);
        const response = await fetchHandler(request);
        await writeFetchResponse(response, res);
      } catch (err) {
        next(err);
      }
    })();
  };
}

/**
 * Mount LaikaCMS's own JSON:API over `repos` at `${basePath}/storage`,
 * `${basePath}/documents`, and `${basePath}/assets`. No auth, no CORS — call
 * this only from `configureServer`.
 */
export function mountLocalApi(
  server: LocalApiServer,
  repos: LaikaRepositories,
  options: LaikaLocalApiOptions | true,
): void {
  const resolved = options === true ? {} : options;
  const basePath = resolved.basePath ?? DEFAULT_LOCAL_API_BASE_PATH;

  if (!isLoopbackHost(server.config.server.host)) {
    const warn = server.config.logger?.warn ?? ((msg: string) => console.warn(msg));
    warn(
      `[@laikacms/vite-plugin] localApi is mounted at "${basePath}" with no authentication, `
        + `and the dev server host is not loopback (--host). Anyone who can reach this host `
        + 'can read and write your content unauthenticated.',
    );
  }

  const storageApi = buildStorageJsonApi({ repo: repos.storage, basePath: `${basePath}/storage` });
  const documentsApi = buildDocumentsJsonApi({ repo: repos.documents, basePath: `${basePath}/documents` });
  const assetsApi = buildAssetsApi({ repository: repos.assets, basePath: `${basePath}/assets` });

  server.middlewares.use(`${basePath}/storage`, toConnectMiddleware(storageApi.fetch));
  server.middlewares.use(`${basePath}/documents`, toConnectMiddleware(documentsApi.fetch));
  server.middlewares.use(`${basePath}/assets`, toConnectMiddleware(assetsApi.fetch));
  server.middlewares.use(`${basePath}/session`, toConnectMiddleware(sessionHandler));
}
