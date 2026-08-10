/**
 * Node.js-only helper that wires a complete Decap CMS backend from a single
 * options object. Not compatible with edge runtimes — use `laikaApi` directly
 * from `@laikacms/server/api` for Cloudflare Workers / Deno Deploy.
 */
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { runTask } from 'laikacms/compat';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
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
  documents: ContentBaseDocumentsRepository;
  /** Raw storage repository (FileSystem). */
  storage: FileSystemStorageRepository;
  /** Assets repository. */
  assets: ContentBaseAssetsRepository;
  /** Fetch handler — route all `/basePath/*` requests here. */
  fetch: (request: Request) => Promise<Response>;
}

const defaultSerializers = {
  md: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
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
 * export const laika = createEmbeddedLaika({
 *   contentDir: resolve(process.cwd(), 'content'),
 *   basePath: '/api/decap',
 *   auth: { mode: 'dev' },
 *   decapConfig: {
 *     backend: { name: 'laika', api_url: '/api/decap' },
 *     media_folder: 'public/uploads',
 *     public_folder: '/uploads',
 *     collections: [...],
 *   },
 * });
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
  const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
  const documents = new ContentBaseDocumentsRepository(storage, settings);
  const assets = new ContentBaseAssetsRepository(storage, settings);

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

  let configSeeded = false;

  async function ensureConfig(): Promise<void> {
    if (configSeeded) return;
    configSeeded = true;
    try {
      await runTask(storage.getObject('config.yml'));
    } catch {
      try {
        await runTask(
          storage.createOrUpdateObject({
            key: 'config.yml',
            type: 'object',
            content: decapConfig,
          }),
        );
      } catch (err) {
        console.error('[createEmbeddedLaika] failed to seed config.yml:', err);
      }
    }
  }

  return {
    documents,
    storage,
    assets,
    async fetch(request: Request): Promise<Response> {
      await ensureConfig();
      return api.fetch(request);
    },
  };
}
