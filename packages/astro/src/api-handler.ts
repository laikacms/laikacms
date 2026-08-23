/**
 * A Laika JSON:API served from an Astro route.
 *
 * Astro hands a route handler a WHATWG `Request` and expects a `Response`, which
 * is exactly what the `laikacms` sub-API builders speak — so this is a router
 * over three of them and nothing more. There is no Node bridging here (unlike
 * the dev-server mount, which has to adapt Connect) and no authentication (see
 * `api-access.ts`).
 */

import { buildAssetsApi } from 'laikacms/assets/api';
import { buildJsonApi as buildDocumentsApi } from 'laikacms/documents/api';
import { buildJsonApi as buildStorageApi } from 'laikacms/storage/api';

import { type ApiAccess, authorizersFor } from './api-access.js';
import type { LaikaRepositories } from './repositories.js';

export interface ApiHandlerOptions {
  repositories: LaikaRepositories;
  /** Path the sub-routes mount under, e.g. `/api/laika`. */
  basePath: string;
  /** Defaults to `'published'`. */
  access?: ApiAccess;
}

export type ApiHandler = (request: Request) => Promise<Response>;

/** Build a handler serving `documents`, `storage` and `assets` under `basePath`. */
export function createApiHandler(options: ApiHandlerOptions): ApiHandler {
  const { repositories, basePath } = options;
  const authorize = authorizersFor(options.access ?? 'published');

  const documents = buildDocumentsApi({
    repo: repositories.documents,
    basePath: `${basePath}/documents`,
    authorize: authorize.documents,
  });
  const storage = buildStorageApi({
    repo: repositories.storage,
    basePath: `${basePath}/storage`,
    authorize: authorize.storage,
  });
  const assets = buildAssetsApi({
    repository: repositories.assets,
    basePath: `${basePath}/assets`,
    authorize: authorize.assets,
  });

  return async request => {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith(`${basePath}/documents`)) return documents.fetch(request);
    if (pathname.startsWith(`${basePath}/storage`)) return storage.fetch(request);
    if (pathname.startsWith(`${basePath}/assets`)) return assets.fetch(request);

    return Response.json(
      {
        errors: [{
          status: '404',
          code: 'not_found',
          title: 'Not Found',
          detail: `No Laika API at ${pathname}. Available: ${basePath}/documents, ${basePath}/storage, `
            + `${basePath}/assets.`,
        }],
      },
      { status: 404, headers: { 'Content-Type': 'application/vnd.api+json' } },
    );
  };
}
