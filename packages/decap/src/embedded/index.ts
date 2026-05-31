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

/**
 * Options accepted by {@link minimalBlogConfig}. All fields are optional —
 * the defaults match what every LaikaCMS starter template wants.
 */
export interface MinimalBlogConfigOptions {
  /** Decap backend block. Defaults to `{ name: 'laika', branch: 'main' }`. */
  backend?: Record<string, unknown>;
  /** Collection technical name (Decap `name`). Default: `'posts'`. */
  collectionName?: string;
  /** Collection display label (Decap `label`). Default: `'Posts'`. */
  collectionLabel?: string;
  /** On-disk folder relative to `contentDir`. Default: same as `collectionName`. */
  folder?: string;
  /** File extension for new entries. Default: `'md'`. */
  extension?: 'md' | 'json' | 'yaml' | 'yml';
  /** Slug template. Default: `'{{slug}}'`. */
  slug?: string;
  /** Media library upload folder. Default: `'public/uploads'`. */
  mediaFolder?: string;
  /** Public URL prefix for uploaded media. Default: `'/uploads'`. */
  publicFolder?: string;
  /** Extra collections to append after the posts collection. */
  extraCollections?: Array<Record<string, unknown>>;
}

/**
 * Returns a minimal but real Decap config object: one Posts collection with
 * title/date/body fields, the `laika` backend, and sane defaults for media.
 *
 * Most LaikaCMS starter templates use this as `decapConfig` so they don't
 * each ship a copy of the same boilerplate. Pass it straight to
 * {@link createEmbeddedLaika}:
 *
 * @example
 *   import { createEmbeddedLaika, minimalBlogConfig } from
 *     '@laikacms/decap-integrations/embedded';
 *
 *   export const laika = createEmbeddedLaika({
 *     contentDir: resolve(process.cwd(), 'content'),
 *     decapConfig: minimalBlogConfig(),
 *     basePath: '/api/decap',
 *     auth: { mode: 'dev' },
 *   });
 *
 * Override only what you need:
 *
 * @example
 *   minimalBlogConfig({
 *     mediaFolder: 'static/uploads',     // SvelteKit / Nuxt
 *     collectionName: 'articles',
 *     extraCollections: [pagesCollection],
 *   })
 */
export function minimalBlogConfig(
  options: MinimalBlogConfigOptions = {},
): Record<string, unknown> {
  const collectionName = options.collectionName ?? 'posts';
  const collectionLabel = options.collectionLabel ?? 'Posts';
  const folder = options.folder ?? collectionName;
  const extension = options.extension ?? 'md';
  const slug = options.slug ?? '{{slug}}';
  const mediaFolder = options.mediaFolder ?? 'public/uploads';
  const publicFolder = options.publicFolder ?? '/uploads';
  const backend = options.backend ?? { name: 'laika', branch: 'main' };

  return {
    backend,
    media_folder: mediaFolder,
    public_folder: publicFolder,
    collections: [
      {
        name: collectionName,
        label: collectionLabel,
        folder,
        create: true,
        slug,
        extension,
        fields: [
          { name: 'title', label: 'Title', widget: 'string' },
          { name: 'date', label: 'Date', widget: 'datetime' },
          { name: 'body', label: 'Body', widget: 'markdown' },
        ],
      },
      ...(options.extraCollections ?? []),
    ],
  };
}

/**
 * Options for {@link decapAdminHtml}.
 */
export interface DecapAdminHtmlOptions {
  /**
   * Decap config object — the same shape you pass to `createEmbeddedLaika`.
   * Defaults to {@link minimalBlogConfig}().
   */
  decapConfig?: Record<string, unknown>;
  /** Page title. Default: `'Admin · LaikaCMS'`. */
  title?: string;
  /**
   * Origin override for `backend.base_url` and `dev_token` injection. By
   * default the helper emits `window.location.origin` and lets the browser
   * resolve it at runtime.
   */
  baseUrl?: string;
  /**
   * Pin a specific Decap CMS UMD bundle URL. Defaults to the latest 3.x on
   * unpkg. Override for SRI / pinned versions / self-hosted bundles.
   */
  decapBundleUrl?: string;
  /**
   * Pin the `@laikacms/decap-integrations/decap-cms-backend-laika` esm bundle
   * URL. Defaults to esm.sh.
   */
  laikaBackendUrl?: string;
  /**
   * Pin the dev-token bundle URL. Defaults to
   * `https://esm.sh/@laikacms/decap-integrations/embedded`.
   */
  embeddedBundleUrl?: string;
}

const DEFAULT_DECAP_BUNDLE = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
const DEFAULT_LAIKA_BACKEND_BUNDLE = 'https://esm.sh/@laikacms/decap-integrations/decap-cms-backend-laika';
const DEFAULT_EMBEDDED_BUNDLE = 'https://esm.sh/@laikacms/decap-integrations/embedded';

/**
 * Returns the HTML for a Decap CMS admin shell that:
 *
 *   1. Loads Decap CMS from a CDN.
 *   2. Registers the `laika` Decap backend (also from a CDN) so writes go to
 *      `${origin}/api/decap/*`.
 *   3. Injects the dev token from `@laikacms/decap-integrations/embedded`
 *      so local dev requires no real OAuth.
 *   4. Calls `CMS.init({ config: { backend, collections, ... } })` with the
 *      `decapConfig` you provide (defaults to {@link minimalBlogConfig}()).
 *
 * Pass the returned string to your framework's HTML response — e.g. Hono's
 * `c.html(decapAdminHtml())`, Express's `res.send(decapAdminHtml())`,
 * SvelteKit's `+server.ts` returning a `Response`. Replaces the ~50-line
 * boilerplate that every starter previously shipped.
 *
 * @example
 *   import { decapAdminHtml, minimalBlogConfig } from
 *     '@laikacms/decap-integrations/embedded';
 *
 *   app.get('/admin', c => c.html(decapAdminHtml()));
 *
 *   // Custom config:
 *   app.get('/admin', c =>
 *     c.html(decapAdminHtml({
 *       decapConfig: minimalBlogConfig({ mediaFolder: 'static/uploads' }),
 *       title: 'My CMS',
 *     })),
 *   );
 */
export function decapAdminHtml(options: DecapAdminHtmlOptions = {}): string {
  const decapConfig = options.decapConfig ?? minimalBlogConfig();
  const title = options.title ?? 'Admin · LaikaCMS';
  const decapBundleUrl = options.decapBundleUrl ?? DEFAULT_DECAP_BUNDLE;
  const laikaBackendUrl = options.laikaBackendUrl ?? DEFAULT_LAIKA_BACKEND_BUNDLE;
  const embeddedBundleUrl = options.embeddedBundleUrl ?? DEFAULT_EMBEDDED_BUNDLE;

  // The `decapConfig` object is JSON-serialized into the inline script so the
  // browser can read it without an extra request. We replace the
  // closing-script-tag sequence to prevent HTML injection inside the JSON.
  const serializedConfig = JSON.stringify(decapConfig, null, 2).replace(/<\/script/gi, '<\\/script');

  // baseUrl: at runtime we read window.location.origin unless the caller
  // pinned a value.
  const baseUrlExpr = options.baseUrl
    ? JSON.stringify(options.baseUrl)
    : 'window.location.origin';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <script src="${escapeHtml(decapBundleUrl)}"></script>
    <script type="module">
      import { createLaikaBackend } from ${JSON.stringify(laikaBackendUrl)};
      import { DEFAULT_DEV_TOKEN } from ${JSON.stringify(embeddedBundleUrl)};

      const CMS = window.CMS;
      CMS.registerBackend('laika', createLaikaBackend());

      const userConfig = ${serializedConfig};
      CMS.init({
        config: {
          ...userConfig,
          backend: {
            ...userConfig.backend,
            base_url: ${baseUrlExpr},
            dev_token: DEFAULT_DEV_TOKEN,
          },
        },
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
