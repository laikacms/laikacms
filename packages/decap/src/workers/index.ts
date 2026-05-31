/**
 * One-call setup for embedding the Laika+Decap stack inside a Cloudflare
 * Workers script (or any other runtime that gives you an `R2Bucket` and
 * web-standard `Request`/`Response`).
 *
 * This is the {@link import('../embedded/index.js').createEmbeddedLaika}
 * counterpart for Workers — same shape, no Node.js imports, R2 storage
 * instead of filesystem. Importing this module does NOT pull `node:fs` or
 * `node:path`, so it stays compatible with V8 isolates and other
 * non-Node runtimes.
 *
 * Composes the pieces you would otherwise wire by hand:
 *   - `R2StorageRepository` over the R2 bucket you pass in.
 *   - `R2AssetsRepository` for binary uploads (configurable sanitizer).
 *   - `DecapContentBaseSettingsProvider` reading `${configKey}.yml` from R2.
 *   - `ContentBaseDocumentsRepository` over R2 storage + settings.
 *   - `decapApi(...)` with your chosen auth mode.
 *
 * One ergonomic difference from `createEmbeddedLaika`: the R2 path can't
 * auto-seed the Decap config on first boot (R2 writes are async and `fetch`
 * has no warmup hook), so the Decap config object must already exist as
 * `${configKey}.yml` in the bucket, OR you set `seedConfigOnFirstRequest:
 * true` and the helper will write it on the first request that arrives.
 *
 * @example
 *   import { createWorkersLaika } from '@laikacms/decap-integrations/workers';
 *   import { decapConfig } from './decap-config';
 *
 *   export interface Env {
 *     CONTENT: R2Bucket;
 *     AUTH_JWT_PUBLIC_KEY: string;
 *   }
 *
 *   export default {
 *     async fetch(request: Request, env: Env): Promise<Response> {
 *       const laika = createWorkersLaika({
 *         bucket: env.CONTENT,
 *         decapConfig,
 *         basePath: '/api/decap',
 *         seedConfigOnFirstRequest: true,
 *         auth: { mode: 'dev' },
 *       });
 *       return laika.fetch(request);
 *     },
 *   };
 */
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { AuthenticationError } from 'laikacms/core';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import type { StorageSerializerRegistry } from 'laikacms/storage';
import { R2StorageRepository } from 'laikacms/storage-r2';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';
import { stringify as yamlStringify } from 'yaml';

import type { DecapApi, DecapOptions, User } from '../decap-api/index.js';
import { decapApi } from '../decap-api/index.js';

/**
 * Re-exported from the embedded preset so Workers code can import everything
 * from a single subpath without pulling node:fs into the bundle. These
 * exports are pure data/string builders with no Node-specific runtime use:
 *
 *   - DEFAULT_DEV_TOKEN  — shared dev-mode bearer token constant
 *   - minimalBlogConfig  — returns a Decap config object literal
 *   - decapAdminHtml     — returns the Decap admin HTML as a string
 */
export { decapAdminHtml, DEFAULT_DEV_TOKEN, minimalBlogConfig } from '../embedded/index.js';
export type { DecapAdminHtmlOptions, MinimalBlogConfigOptions } from '../embedded/index.js';

/**
 * Minimal structural type for a Cloudflare R2 bucket. We don't take a
 * dependency on `@cloudflare/workers-types` so this preset stays installable
 * in non-Workers projects (e.g. wrapper Hono apps that ship to multiple
 * runtimes). At call sites that already import `@cloudflare/workers-types`,
 * the global `R2Bucket` is assignable to this structural shape.
 */
export interface MinimalR2Bucket {
  head(key: string): Promise<unknown>;
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream): Promise<unknown>;
}

export type WorkersLaikaAuth =
  | {
    mode: 'dev',
    /** Token the embedded server will accept. Defaults to `DEFAULT_DEV_TOKEN`. */
    devToken?: string,
    /** User object returned for the dev token. Defaults to a generic dev editor. */
    devUser?: User,
  }
  | {
    mode: 'custom',
    authenticateAccessToken: DecapOptions['authenticateAccessToken'],
    authenticateApiToken?: DecapOptions['authenticateApiToken'],
  };

export interface CreateWorkersLaikaOptions {
  /**
   * R2 bucket to use for content storage. Pass `env.YOUR_BUCKET` from a
   * Cloudflare Worker — the `R2Bucket` global is assignable to
   * {@link MinimalR2Bucket}.
   */
  bucket: MinimalR2Bucket;
  /** Decap CMS config object. Required. */
  decapConfig: Record<string, unknown>;
  /** Path the Decap API is mounted at on the host server. Default: `/api/decap`. */
  basePath?: string;
  /** Authentication strategy. Required. */
  auth: WorkersLaikaAuth;
  /** Key (without extension) of the Decap config in R2. Default: `config`. */
  configKey?: string;
  /** Default file extension for new documents. Default: `md`. */
  defaultFileExtension?: string;
  /** Override the storage serializer registry. */
  serializers?: StorageSerializerRegistry;
  /**
   * If `true`, the first request handled by `laika.fetch` will write
   * `${configKey}.yml` to R2 if it doesn't already exist. Useful for dev;
   * leave `false` in production once the config is in place. Default: `false`.
   */
  seedConfigOnFirstRequest?: boolean;
  /** Logger forwarded to `decapApi`. Default: `console`. */
  logger?: DecapOptions['logger'];
  /**
   * Reserved for future binary-asset support. The current preset wires
   * `ContentBaseAssetsRepository` over R2 storage (metadata-only); when a
   * dedicated `R2AssetsRepository` mode lands, this option will pick the
   * sanitizer. For now it is ignored.
   */
  assetSanitizer?: unknown;
}

export interface WorkersLaika {
  /** Mount this on every method at `${basePath}/*`. */
  fetch: DecapApi['fetch'];
  authenticateRequest: DecapApi['authenticateRequest'];
  storage: R2StorageRepository;
  documents: ContentBaseDocumentsRepository;
  assets: ContentBaseAssetsRepository;
}

const defaultSerializers: StorageSerializerRegistry = {
  md: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
  txt: rawSerializer,
};

const defaultDevUser: User = {
  id: 'dev',
  email: 'dev@local.test',
  name: 'Dev Editor',
};

function resolveAuth(auth: WorkersLaikaAuth): {
  authenticateAccessToken: DecapOptions['authenticateAccessToken'],
  authenticateApiToken?: DecapOptions['authenticateApiToken'],
} {
  if (auth.mode === 'dev') {
    const devToken = auth.devToken ?? 'dev-local-laika-token';
    const devUser = auth.devUser ?? defaultDevUser;
    return {
      authenticateAccessToken: async token => {
        if (token !== devToken) {
          throw new AuthenticationError('Unknown token (createWorkersLaika is in dev mode)');
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

export function createWorkersLaika(opts: CreateWorkersLaikaOptions): WorkersLaika {
  const basePath = opts.basePath ?? '/api/decap';
  const configKey = opts.configKey ?? 'config';
  const defaultFileExtension = opts.defaultFileExtension ?? 'md';
  const serializers = opts.serializers ?? defaultSerializers;
  const logger = opts.logger ?? console;
  void opts.assetSanitizer;

  const storage = new R2StorageRepository(opts.bucket, serializers, defaultFileExtension);
  const settings = new DecapContentBaseSettingsProvider({ storage, configKey });
  const documents = new ContentBaseDocumentsRepository(storage, settings);
  const assets = new ContentBaseAssetsRepository(storage, settings);

  const api = decapApi({
    documents,
    storage,
    assets,
    basePath,
    logger,
    ...resolveAuth(opts.auth),
  });

  let seedAttempted = false;

  const fetchWithSeed: DecapApi['fetch'] = async (request: Request) => {
    if (opts.seedConfigOnFirstRequest && !seedAttempted) {
      seedAttempted = true;
      const configObjectKey = `${configKey}.yml`;
      try {
        const existing = await opts.bucket.head(configObjectKey);
        if (!existing) {
          await opts.bucket.put(configObjectKey, yamlStringify(opts.decapConfig));
        }
      } catch (err) {
        logger.warn?.('createWorkersLaika: failed to seed config to R2:', err);
      }
    }
    return api.fetch(request);
  };

  return {
    fetch: fetchWithSeed,
    authenticateRequest: api.authenticateRequest,
    storage,
    documents,
    assets,
  };
}
