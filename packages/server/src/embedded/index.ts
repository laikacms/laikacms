/**
 * Node.js-only helper that wires a complete Decap CMS backend from a single
 * options object. Not compatible with edge runtimes — use `laikaApi` directly
 * from `@laikacms/server/api` for Cloudflare Workers / Deno Deploy.
 */
import { CatalogAssetsRepository } from 'laikacms/assets-catalog';
import { DecapCatalogProvider } from 'laikacms/catalog-decap';
import { runTask } from 'laikacms/compat';
import { CatalogDocumentsRepository } from 'laikacms/documents-catalog';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { laikaApi } from '../api/index.js';
import type { LaikaApi, User } from '../api/index.js';

export { LaikaApi };

/** Bearer token used in dev mode when no `devToken` override is supplied. */
export const DEFAULT_DEV_TOKEN = 'dev-local-laika-token';

/** Auth mode for `createEmbeddedLaika`. */
export type EmbeddedAuth =
  | {
    mode: 'dev',
    /** Override the default dev bearer token (`DEFAULT_DEV_TOKEN`). */
    devToken?: string,
  }
  | {
    mode: 'token',
    /** Custom token authenticator — return a `User` or throw to reject. */
    authenticate: (token: string) => Promise<User>,
  };

export interface EmbeddedLaikaOptions {
  /** Absolute path to the content directory (roots `FileSystemStorageRepository`). */
  contentDir: string;
  /** URL prefix for all Decap JSON:API endpoints. Defaults to `'/api/decap'`. */
  basePath?: string;
  /** Authentication mode. Defaults to `{ mode: 'dev' }`. */
  auth?: EmbeddedAuth;
  /**
   * Decap CMS config object — written to `config.yml` in `contentDir` on first
   * request if not already present, and served to the admin UI.
   */
  decapConfig: Record<string, unknown>;
}

export interface EmbeddedLaika {
  /** Documents repository — use this in SSR routes to read/write content. */
  documents: CatalogDocumentsRepository;
  /** Raw storage repository (FileSystem). */
  storage: FileSystemStorageRepository;
  /** Assets repository. */
  assets: CatalogAssetsRepository;
  /** Fetch handler — route all `/basePath/*` requests here. */
  fetch: (request: Request) => Promise<Response>;
  /**
   * Await this before accessing `documents`, `storage`, or `assets` directly
   * (e.g. in SSR route handlers). Seeds `config.yml` if absent. Idempotent —
   * safe to call multiple times; the seeding only runs once.
   */
  ensureReady: () => Promise<void>;
}

const defaultSerializers = {
  md: markdownSerializer,
  markdown: markdownSerializer,
  mdx: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
  raw: rawSerializer,
  txt: rawSerializer,
};

/**
 * Create a complete, embedded Decap CMS backend backed by the local filesystem.
 *
 * @example
 * ```ts
 * import { resolve } from 'node:path';
 * import { createEmbeddedLaika } from '@laikacms/server/embedded';
 *
 * const laika = createEmbeddedLaika({
 *   contentDir: resolve(process.cwd(), 'content'),
 *   basePath: '/api/decap',
 *   auth: { mode: 'dev' },
 *   decapConfig: {
 *     backend: { name: 'laika', api_root: '/api/decap' },
 *     media_folder: 'public/uploads',
 *     public_folder: '/uploads',
 *     collections: [...],
 *   },
 * });
 *
 * // Await before starting the server so direct repo access (SSR routes) is safe:
 * await laika.ensureReady();
 * server.listen(3000);
 * ```
 */
export function createEmbeddedLaika(options: EmbeddedLaikaOptions): EmbeddedLaika {
  const {
    contentDir,
    basePath = '/api/decap',
    auth = { mode: 'dev' },
    decapConfig,
  } = options;

  const storage = new FileSystemStorageRepository(contentDir, defaultSerializers, 'md');
  const settings = new DecapCatalogProvider({ storage, configKey: 'config' });
  const documents = new CatalogDocumentsRepository(storage, settings);
  const assets = new CatalogAssetsRepository(storage, settings);

  const authenticateAccessToken: (token: string) => Promise<User> = auth.mode === 'dev'
    ? (async token => {
      const expected = auth.devToken ?? DEFAULT_DEV_TOKEN;
      if (token !== expected) throw new Error('Unauthorized');
      return { id: 'dev', email: 'dev@local.test', name: 'Dev Editor' };
    })
    : auth.authenticate;

  const api: LaikaApi = laikaApi({
    documents,
    storage,
    assets,
    basePath,
    authenticateAccessToken,
    authorize: () => true,
  });

  // Seed config eagerly so direct repo access (SSR routes) is safe without
  // waiting for a first fetch() call. The promise is shared — subsequent calls
  // to ensureReady() and fetch() await the same settled promise.
  const readyPromise: Promise<void> = (async () => {
    try {
      await runTask(storage.getObject('config.yml'));
    } catch {
      try {
        await runTask(
          storage.createOrUpdateObject({
            key: 'config.yml',
            type: 'object',
            content: decapConfig,
            metadata: { extension: 'yml' },
          }),
        );
      } catch (err) {
        console.error('[createEmbeddedLaika] failed to seed config.yml:', err);
      }
    }
  })();

  return {
    documents,
    storage,
    assets,
    ensureReady: () => readyPromise,
    async fetch(request: Request): Promise<Response> {
      await readyPromise;
      return api.fetch(request);
    },
  };
}
