/**
 * Local mode — mount LaikaCMS's own JSON:API over the dev server.
 *
 * While `vite dev` is running, {@link mountLocalApi} exposes the plugin's own
 * `storage`/`documents` repositories through the same JSON:API contract the
 * Decap laika-backend already speaks, so a JSON:API client (the Decap admin,
 * or any other) can read and write content locally instead of a remote
 * backend. Unauthenticated by design — see the module-level warning below —
 * and reachable only through the dev server, because {@link mountLocalApi} is
 * only ever called from `configureServer`; nothing in the `build` phase or
 * `configurePreviewServer` calls it, so a production build has no route to
 * it by construction.
 *
 * The assets endpoint (`${basePath}/assets`) mounts only when a caller
 * supplies {@link LaikaLocalApiOptions.assets} — with no assets repository
 * the route is never registered, so a request to it 404s as if it never
 * existed rather than being stubbed out.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import type { AssetsRepository } from 'laikacms/assets';
import { buildAssetsApi } from 'laikacms/assets-api';
import { buildJsonApi as buildDocumentsJsonApi } from 'laikacms/documents-api';
import { buildJsonApi as buildStorageJsonApi } from 'laikacms/storage-api';

import type { LaikaRepositories } from './backend.js';

/** Default base path both local-mode sub-APIs mount under. */
export const DEFAULT_LOCAL_API_BASE_PATH = '/__laika';

export interface LaikaLocalApiOptions {
  /**
   * Base path both `storage` and `documents` sub-routes mount under.
   * Defaults to {@link DEFAULT_LOCAL_API_BASE_PATH}.
   */
  basePath?: string;
  /**
   * A user-provided assets repository. When supplied, LaikaCMS's own
   * `buildAssetsApi` is mounted at `${basePath}/assets` so Decap media
   * uploads in dev land locally. When omitted, `${basePath}/assets` is not
   * registered at all — no phantom endpoint.
   */
  assets?: AssetsRepository;
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
  const url = new URL(req.url ?? '/', `http://${host}`);
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
 * Mount LaikaCMS's own JSON:API over `repos` at `${basePath}/storage` and
 * `${basePath}/documents`, plus `${basePath}/assets` when
 * {@link LaikaLocalApiOptions.assets} is supplied. No auth, no CORS — call
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

  server.middlewares.use(`${basePath}/storage`, toConnectMiddleware(storageApi.fetch));
  server.middlewares.use(`${basePath}/documents`, toConnectMiddleware(documentsApi.fetch));

  if (resolved.assets) {
    const assetsApi = buildAssetsApi({ repository: resolved.assets, basePath: `${basePath}/assets` });
    server.middlewares.use(`${basePath}/assets`, toConnectMiddleware(assetsApi.fetch));
  }
}
