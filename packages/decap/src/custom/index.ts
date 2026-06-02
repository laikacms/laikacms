/**
 * Storage-agnostic preset.
 *
 * `createEmbeddedLaika` is tied to FileSystem. `createWorkersLaika` is tied
 * to R2. This preset takes a **pre-built `StorageRepository`** of any kind
 * (FS, R2, Drizzle/SQL, GitHub, custom) and wires the ContentBase document
 * + asset repos, optional config seeding, and the Decap JSON:API router
 * around it.
 *
 * Use this when your storage has nontrivial setup (async migrations,
 * connection pools, multi-tenant prefixes) that the specialized presets
 * don't accommodate — but you still want the boilerplate of "wire repos +
 * api + dev-mode auth" to be one function call.
 *
 * @example  Drizzle / libsql
 *   const storage = await createDrizzleStorage(DB_URL);  // your own factory
 *   const laika = createCustomLaika({
 *     storage,
 *     decapConfig: minimalBlogConfig(),
 *     basePath: '/api/decap',
 *     auth: { mode: 'dev' },
 *   });
 *   app.all('/api/decap/*', c => laika.fetch(c.req.raw));
 *
 * @example  R2 via an arbitrary client (skip createWorkersLaika)
 *   const storage = new R2StorageRepository(bucket, serializers, 'md');
 *   const laika = createCustomLaika({ storage, decapConfig, basePath, auth });
 */
import * as Effect from 'effect/Effect';

import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { runTask } from 'laikacms/compat';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { AuthenticationError, NotFoundError } from 'laikacms/core';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import type { StorageRepository } from 'laikacms/storage';
import { stringify as yamlStringify } from 'yaml';

import type { DecapApi, DecapOptions, User } from '../decap-api/index.js';
import { decapApi } from '../decap-api/index.js';

/** Re-exports so callers can `import { ... } from '@laikacms/decap-integrations/custom'`. */
export { decapAdminHtml, DEFAULT_DEV_TOKEN, minimalBlogConfig } from '../embedded/index.js';
export type { DecapAdminHtmlOptions, MinimalBlogConfigOptions } from '../embedded/index.js';

export type CustomLaikaAuth =
  | {
    mode: 'dev',
    devToken?: string,
    devUser?: User,
  }
  | {
    mode: 'custom',
    authenticateAccessToken: DecapOptions['authenticateAccessToken'],
    authenticateApiToken?: DecapOptions['authenticateApiToken'],
  };

export interface CreateCustomLaikaOptions {
  /** Pre-built StorageRepository (FS, R2, Drizzle, GitHub — any kind). */
  storage: StorageRepository;
  /** Decap CMS config object. */
  decapConfig: Record<string, unknown>;
  /** Path the Decap API is mounted at on the host server. Default: `/api/decap`. */
  basePath?: string;
  /** Authentication strategy. */
  auth: CustomLaikaAuth;
  /** Key (without extension) of the Decap config in storage. Default: `config`. */
  configKey?: string;
  /**
   * If `true`, the first request to `laika.fetch` will write
   * `${configKey}.yml` into storage if it doesn't already exist. Useful for
   * dev; leave `false` once content is bootstrapped. Default: `true`.
   */
  seedConfigOnFirstRequest?: boolean;
  /** Logger forwarded to `decapApi`. Default: `console`. */
  logger?: DecapOptions['logger'];
}

export interface CustomLaika {
  /** Mount this on every method at `${basePath}/*`. */
  fetch: DecapApi['fetch'];
  authenticateRequest: DecapApi['authenticateRequest'];
  storage: StorageRepository;
  documents: ContentBaseDocumentsRepository;
  assets: ContentBaseAssetsRepository;
}

const defaultDevUser: User = {
  id: 'dev',
  email: 'dev@local.test',
  name: 'Dev Editor',
};

function resolveAuth(auth: CustomLaikaAuth): {
  authenticateAccessToken: DecapOptions['authenticateAccessToken'],
  authenticateApiToken?: DecapOptions['authenticateApiToken'],
} {
  if (auth.mode === 'dev') {
    const devToken = auth.devToken ?? 'dev-local-laika-token';
    const devUser = auth.devUser ?? defaultDevUser;
    return {
      authenticateAccessToken: async token => {
        if (token !== devToken) {
          throw new AuthenticationError('Unknown token (createCustomLaika is in dev mode)');
        }
        return { ...devUser };
      },
    };
  }
  return {
    authenticateAccessToken: auth.authenticateAccessToken,
    authenticateApiToken: auth.authenticateApiToken,
  };
}

export function createCustomLaika(opts: CreateCustomLaikaOptions): CustomLaika {
  const basePath = opts.basePath ?? '/api/decap';
  const configKey = opts.configKey ?? 'config';
  const logger = opts.logger ?? console;
  const shouldSeed = opts.seedConfigOnFirstRequest ?? true;

  const settings = new DecapContentBaseSettingsProvider({
    storage: opts.storage,
    configKey,
  });
  const documents = new ContentBaseDocumentsRepository(opts.storage, settings);
  const assets = new ContentBaseAssetsRepository(opts.storage, settings);

  const api = decapApi({
    documents,
    storage: opts.storage,
    assets,
    basePath,
    logger,
    ...resolveAuth(opts.auth),
  });

  let seedAttempted = false;

  const fetchWithSeed: DecapApi['fetch'] = async request => {
    if (shouldSeed && !seedAttempted) {
      seedAttempted = true;
      const configObjectKey = `${configKey}.yml`;
      try {
        await runTask(opts.storage.getObject(configObjectKey));
      } catch (err) {
        if (err instanceof NotFoundError) {
          try {
            await runTask(
              opts.storage.createObject({
                key: configObjectKey,
                content: yamlStringify(opts.decapConfig) as never,
              } as never),
            );
          } catch (writeErr) {
            logger.warn?.('createCustomLaika: failed to seed config:', writeErr);
          }
        } else {
          // Read failure that isn't 404: log and proceed.
          logger.warn?.('createCustomLaika: failed to check config presence:', err);
        }
      }
    }
    return api.fetch(request);
  };

  // Touch Effect import so the linter doesn't strip it — we may want it for
  // future Effect-aware extensions to the seeding flow.
  void Effect;

  return {
    fetch: fetchWithSeed,
    authenticateRequest: api.authenticateRequest,
    storage: opts.storage,
    documents,
    assets,
  };
}
