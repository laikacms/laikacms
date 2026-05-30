/**
 * One-call setup for embedding the Laika+Decap stack inside another app
 * (Astro, Next, Express, Hono — anything that can route to a
 * `(Request) => Promise<Response>`).
 *
 * Composes the pieces you would otherwise wire by hand:
 *   - `FileSystemStorageRepository` rooted at `contentDir`
 *   - `DecapContentBaseSettingsProvider` reading `${contentDir}/${configKey}.yml`
 *     (seeded from `decapConfig` on first run so the editor and the
 *     server always agree on the schema)
 *   - `ContentBaseDocumentsRepository` + `ContentBaseAssetsRepository`
 *   - `decapApi(...)` with your chosen auth mode
 *
 * Returns the `fetch` handler plus the underlying repos in case the host
 * wants to read content directly without going back through HTTP.
 *
 * @example
 *   const laika = createEmbeddedLaika({
 *     contentDir: resolve(process.cwd(), 'content'),
 *     decapConfig,
 *     basePath: '/api/decap',
 *     auth: { mode: 'dev' },
 *   });
 *   // Astro endpoint:
 *   export const ALL: APIRoute = ({ request }) => laika.fetch(request);
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { AuthenticationError } from 'laikacms/core';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import type { StorageSerializerRegistry } from 'laikacms/storage';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';
import { stringify as yamlStringify } from 'yaml';

import type { DecapApi, DecapOptions, User } from '../decap-api/index.js';
import { decapApi } from '../decap-api/index.js';

/**
 * Default dev token shared by `createEmbeddedLaika({ auth: { mode: 'dev' } })`
 * and the `laika` Decap backend's `dev_token` config option. Override per-app
 * if you want a less guessable string — but in dev mode there is no real
 * authentication, so this is purely cosmetic.
 */
export const DEFAULT_DEV_TOKEN = 'dev-local-laika-token' as const;

export type EmbeddedLaikaAuth =
  | {
    mode: 'dev',
    /** Token the embedded server will accept. Defaults to {@link DEFAULT_DEV_TOKEN}. */
    devToken?: string,
    /** User object returned for the dev token. Defaults to a generic dev editor. */
    devUser?: User,
  }
  | {
    mode: 'custom',
    /** Validate a Bearer token; throw or reject for invalid. */
    authenticateAccessToken: DecapOptions['authenticateAccessToken'],
    /** Optional API-key validator (e.g. for CI / scripts). */
    authenticateApiToken?: DecapOptions['authenticateApiToken'],
  };

export interface CreateEmbeddedLaikaOptions {
  /** Absolute path to the content directory. Content + Decap config live here. */
  contentDir: string;
  /** Decap CMS config object — same shape you'd put in `admin/config.yml`. */
  decapConfig: Record<string, unknown>;
  /** Path the Decap API is mounted at on the host server. Default: `/api/decap`. */
  basePath?: string;
  /** Authentication strategy. */
  auth: EmbeddedLaikaAuth;
  /**
   * Key (without extension) of the Decap config in storage. Default: `config`,
   * resolving to `${contentDir}/config.yml`.
   */
  configKey?: string;
  /**
   * Default file extension for new documents. Default: `md` (markdown with
   * YAML frontmatter — the most common Decap layout).
   */
  defaultFileExtension?: string;
  /**
   * Override the storage serializer registry. Defaults to a sane preset:
   * `{ md: markdown, yaml/yml: yaml, json: json, txt: raw }`.
   */
  serializers?: StorageSerializerRegistry;
  /** Logger forwarded to `decapApi`. Default: `console`. */
  logger?: DecapOptions['logger'];
}

export interface EmbeddedLaika {
  /** Mount this on every method at `${basePath}/*`. */
  fetch: DecapApi['fetch'];
  /** Re-authenticate a request without serving it (useful for middlewares). */
  authenticateRequest: DecapApi['authenticateRequest'];
  /** Underlying repos, exposed so the host can read content without HTTP. */
  storage: FileSystemStorageRepository;
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

function ensureConfigOnDisk(
  contentDir: string,
  configKey: string,
  decapConfig: Record<string, unknown>,
): void {
  const target = resolve(contentDir, `${configKey}.yml`);
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, yamlStringify(decapConfig), 'utf8');
}

function resolveAuth(auth: EmbeddedLaikaAuth): {
  authenticateAccessToken: DecapOptions['authenticateAccessToken'],
  authenticateApiToken?: DecapOptions['authenticateApiToken'],
} {
  if (auth.mode === 'dev') {
    const devToken = auth.devToken ?? DEFAULT_DEV_TOKEN;
    const devUser = auth.devUser ?? defaultDevUser;
    return {
      authenticateAccessToken: async token => {
        if (token !== devToken) {
          throw new AuthenticationError('Unknown token (createEmbeddedLaika is in dev mode)');
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

export function createEmbeddedLaika(opts: CreateEmbeddedLaikaOptions): EmbeddedLaika {
  const basePath = opts.basePath ?? '/api/decap';
  const configKey = opts.configKey ?? 'config';
  const defaultFileExtension = opts.defaultFileExtension ?? 'md';
  const serializers = opts.serializers ?? defaultSerializers;
  const logger = opts.logger ?? console;

  mkdirSync(opts.contentDir, { recursive: true });
  ensureConfigOnDisk(opts.contentDir, configKey, opts.decapConfig);

  const storage = new FileSystemStorageRepository(
    opts.contentDir,
    serializers,
    defaultFileExtension,
  );
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

  return {
    fetch: api.fetch,
    authenticateRequest: api.authenticateRequest,
    storage,
    documents,
    assets,
  };
}
