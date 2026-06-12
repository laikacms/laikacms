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
  const backend = options.backend ?? { name: 'laika', branch: 'main', api_root: '/api/decap' };

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
   * URL for a pre-built admin bundle that calls
   * `CMS.registerBackend` and `CMS.init`. When supplied, the inline
   * backend registration script is replaced by a `<script src>` tag pointing
   * at this URL and no other backend code is emitted.
   *
   * Use this when you have a custom esbuild/webpack bundle that packages
   * `@laikacms/decap-integrations/decap-cms-backend-laika` from your local
   * workspace. Omit it (the default) to use the built-in inline backend that
   * requires no separate build step.
   */
  adminBundleUrl?: string;
  /**
   * Inject a pre-issued access token directly into the admin shell instead of
   * loading `DEFAULT_DEV_TOKEN` from CDN. Use this for **production auth**:
   * issue a JWT on the server after your own login flow, then pass it here so
   * the Decap admin authenticates as the signed-in user without a separate
   * OAuth round-trip.
   *
   * @example
   *   app.get('/admin', requireLogin, async c => {
   *     const token = await signUserJwt(c.get('user'));
   *     return c.html(decapAdminHtml({ devToken: token }));
   *   });
   */
  devToken?: string;
}

const DEFAULT_DECAP_BUNDLE = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';

/**
 * Returns the HTML for a Decap CMS admin shell that:
 *
 *   1. Loads Decap CMS from a CDN (sets `window.CMS_MANUAL_INIT = true` first
 *      so Decap does not auto-fetch `/config.yml`).
 *   2. Registers the `laika` Decap backend via an inline script — no bundler
 *      or CDN import required.
 *   3. Injects the dev token directly so local dev requires no real OAuth.
 *   4. Calls `CMS.init({ config: { backend, collections, ... } })` with the
 *      `decapConfig` you provide (defaults to {@link minimalBlogConfig}()).
 *
 * Pass the returned string to your framework's HTML response — e.g. Hono's
 * `c.html(decapAdminHtml())`, Express's `res.send(decapAdminHtml())`,
 * SvelteKit's `+server.ts` returning a `Response`. Replaces the ~50-line
 * boilerplate that every starter previously shipped.
 *
 * @remarks
 * A bare `decapAdminHtml()` call ignores any collections passed to
 * `createCustomLaika`. To keep the admin in sync with your server-side
 * config, pass `decapConfig` explicitly:
 * `decapAdminHtml({ decapConfig: laika.decapConfig })`
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
  const { devToken, adminBundleUrl } = options;

  // The `decapConfig` object is JSON-serialized into the inline script so the
  // browser can read it without an extra request. We replace the
  // closing-script-tag sequence to prevent HTML injection inside the JSON.
  const serializedConfig = JSON.stringify(
    {
      ...decapConfig,
      // Suppress Decap's automatic /config.yml fetch — config is inlined below.
      load_config_file: false,
    },
    null,
    2,
  ).replace(/<\/script/gi, '<\\/script');

  // devToken injection: if a token is supplied server-side, serialize it
  // directly into the script so no CDN import is needed and the Decap admin
  // authenticates as the signed-in user without a separate OAuth round-trip.
  const tokenLiteral = devToken
    ? JSON.stringify(devToken)
    : JSON.stringify(DEFAULT_DEV_TOKEN);

  // baseUrl: at runtime we read window.location.origin unless the caller
  // pinned a value.
  const baseUrlExpr = options.baseUrl
    ? JSON.stringify(options.baseUrl)
    : 'window.location.origin';

  // When the caller provides a pre-built bundle URL (e.g. an esbuild output
  // that imports the full createLaikaBackend from the workspace), delegate
  // entirely to that bundle and skip the inline backend.
  if (adminBundleUrl) {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <!-- Must be set before the CDN script so Decap does not auto-fetch /config.yml -->
    <script>window.CMS_MANUAL_INIT = true;</script>
  </head>
  <body>
    <script src="${escapeHtml(decapBundleUrl)}"></script>
    <script type="module" src="${escapeHtml(adminBundleUrl)}"></script>
  </body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <!-- Must be set before the CDN script so Decap does not auto-fetch /config.yml -->
    <script>window.CMS_MANUAL_INIT = true;</script>
  </head>
  <body>
    <script src="${escapeHtml(decapBundleUrl)}"></script>
    <script>
      /* Inline Laika backend — no bundler or CDN import required.
         Uses window.createClass and window.h exposed by the Decap CMS UMD bundle above.
         NOTE: decap-cms@3.x does NOT expose window.React — use window.createClass + window.h. */
      (function () {
        'use strict';

        function normalizeKey(key) {
          return key.replace(/\\.(json|yaml|yml|md|markdown|toml)$/i, '');
        }

        function authHeaders(token) {
          return {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/vnd.api+json',
            'Accept': 'application/vnd.api+json',
          };
        }

        async function apiFetch(url, token, init) {
          var res = await fetch(url, Object.assign({ headers: authHeaders(token) }, init || {}));
          if (!res.ok) {
            var text = await res.text();
            throw new Error('Laika API ' + res.status + ': ' + text);
          }
          return res;
        }

        function createLaikaBackend() {
          function LaikaBackend(config) {
            this.config = config;
            this.mediaFolder = config.media_folder || '';
            this.publicFolder = config.public_folder || config.media_folder || '';
            this.baseUrl = (config.backend.base_url || '').replace(/\\/$/, '');
            var backendCfg = config.backend;
            var apiPath = backendCfg.api_root || backendCfg.api_url || '/api/decap';
            this.apiUrl = apiPath.match(/^https?:\\/\\//)
              ? apiPath.replace(/\\/$/, '')
              : this.baseUrl + '/' + apiPath.replace(/^\\//, '');
            this.devToken = backendCfg.dev_token || null;
            this._token = null;
          }

          LaikaBackend.prototype.isGitBackend = function () { return false; };

          LaikaBackend.prototype.status = async function () {
            try {
              var res = await fetch(this.apiUrl + '/health');
              return { auth: { status: !!this._token }, api: { status: res.ok, statusPage: this.apiUrl } };
            } catch (e) {
              return { auth: { status: false }, api: { status: false, statusPage: this.apiUrl } };
            }
          };

          LaikaBackend.prototype.authComponent = function () {
            if (this.devToken) {
              var devToken = this.devToken;
              // decap-cms@3.x exposes window.createClass (Preact-compat), NOT window.React.
              // Use class component lifecycle (componentDidMount) instead of hooks.
              return window.createClass({
                displayName: 'DevAutoLogin',
                componentDidMount: function () {
                  if (this.props.onLogin) this.props.onLogin({ token: devToken });
                },
                render: function () { return null; },
              });
            }
            // Minimal PKCE-less login form for non-dev usage.
            // Uses window.createClass + window.h (Preact-compat) — window.React is not
            // exposed by decap-cms@3.x and must not be referenced here.
            var apiUrl = this.apiUrl;
            return window.createClass({
              displayName: 'TokenLoginForm',
              getInitialState: function () { return { token: '' }; },
              handleSubmit: function (e) {
                e.preventDefault();
                if (this.state.token && this.props.onLogin) this.props.onLogin({ token: this.state.token });
              },
              handleChange: function (e) {
                this.setState({ token: e.target.value });
              },
              render: function () {
                var h = window.h;
                return h('div', { style: { padding: '2rem', maxWidth: '400px', margin: '4rem auto', fontFamily: 'sans-serif' } },
                  h('h2', null, 'LaikaCMS Login'),
                  h('p', { style: { color: '#666', fontSize: '0.9rem' } }, 'API: ' + apiUrl),
                  h('form', { onSubmit: this.handleSubmit },
                    h('input', {
                      type: 'password',
                      placeholder: 'Access token',
                      value: this.state.token,
                      onChange: this.handleChange,
                      style: { display: 'block', width: '100%', padding: '0.5rem', marginBottom: '1rem', boxSizing: 'border-box' },
                    }),
                    h('button', { type: 'submit', style: { padding: '0.5rem 1.5rem' } }, 'Login')
                  )
                );
              },
            });
          };

          var SESSION_KEY = 'laika_access_token';

          LaikaBackend.prototype.restoreUser = function () {
            if (this.devToken) return this.authenticate({ token: this.devToken });
            var stored = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null;
            if (!stored) return Promise.reject(new Error('No session — please log in'));
            return this.authenticate({ token: stored });
          };

          LaikaBackend.prototype.authenticate = async function (credentials) {
            var token = credentials.token || credentials.access_token;
            if (!token) throw new Error('No access token provided');
            this._token = token;
            var res = await apiFetch(this.apiUrl + '/session', token);
            var body = await res.json();
            var attrs = (body.data && body.data.attributes) || body;
            if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SESSION_KEY, token);
            return { name: attrs.name || attrs.email || 'User', login: attrs.email || '', token: token };
          };

          LaikaBackend.prototype.logout = function () {
            if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_KEY);
            this._token = null;
          };

          LaikaBackend.prototype.getToken = function () {
            if (!this._token) throw new Error('Not authenticated');
            return Promise.resolve(this._token);
          };

          LaikaBackend.prototype.entriesByFolder = async function (folder, _ext, _depth) {
            var token = this._token;
            var url = this.apiUrl + '/documents?filter[folder]=' + encodeURIComponent(folder) + '&filter[type]=published&page[limit]=100';
            var res = await apiFetch(url, token);
            var body = await res.json();
            var items = body.data || [];
            return items.map(function (d) {
              var attrs = d.attributes || {};
              var content = attrs.content;
              var raw = typeof content === 'string' ? content : JSON.stringify(content);
              return { file: { path: d.id, id: d.id }, data: raw };
            });
          };

          LaikaBackend.prototype.allEntriesByFolder = async function (folder, ext, depth, pathRegex) {
            var entries = await this.entriesByFolder(folder, ext, depth);
            return pathRegex ? entries.filter(function (e) { return pathRegex.test(e.file.path); }) : entries;
          };

          LaikaBackend.prototype.entriesByFiles = async function (files) {
            var self = this;
            var results = [];
            for (var i = 0; i < files.length; i++) {
              try { results.push(await self.getEntry(files[i].path)); } catch (e) { /* skip */ }
            }
            return results;
          };

          LaikaBackend.prototype.getEntry = async function (path) {
            var token = this._token;
            var key = normalizeKey(path);
            var res = await apiFetch(this.apiUrl + '/documents/' + encodeURIComponent(key), token);
            var body = await res.json();
            var attrs = (body.data && body.data.attributes) || {};
            var content = attrs.content;
            var raw = typeof content === 'string' ? content : JSON.stringify(content);
            return { file: { path: key, id: key }, data: raw };
          };

          LaikaBackend.prototype.persistEntry = async function (entry, options) {
            var token = this._token;
            var self = this;
            if (entry.assets && entry.assets.length > 0) {
              for (var i = 0; i < entry.assets.length; i++) {
                await self.persistMedia(entry.assets[i], options);
              }
            }
            for (var j = 0; j < entry.dataFiles.length; j++) {
              var dataFile = entry.dataFiles[j];
              var key = normalizeKey(dataFile.path);
              var content;
              try { content = JSON.parse(dataFile.raw); } catch (e) { content = dataFile.raw; }
              var payload = JSON.stringify({
                data: { type: 'documents', id: key, attributes: { content: content } },
              });
              try {
                await apiFetch(self.apiUrl + '/documents/' + encodeURIComponent(key), token, { method: 'PATCH', body: payload });
              } catch (e) {
                await apiFetch(self.apiUrl + '/documents', token, { method: 'POST', body: JSON.stringify({
                  data: { type: 'documents', attributes: { key: key, content: content, language: 'unk' } },
                }) });
              }
            }
          };

          LaikaBackend.prototype.deleteFiles = async function (paths, _msg) {
            var token = this._token;
            var self = this;
            for (var i = 0; i < paths.length; i++) {
              var key = normalizeKey(paths[i]);
              try { await apiFetch(self.apiUrl + '/documents/' + encodeURIComponent(key), token, { method: 'DELETE' }); } catch (e) { /* ignore */ }
            }
          };

          LaikaBackend.prototype.getMedia = async function (mediaFolder) {
            var folder = mediaFolder || this.mediaFolder;
            var token = this._token;
            var url = this.apiUrl + '/assets/resources?filter[folder]=' + encodeURIComponent(folder) + '&page[limit]=100';
            var res = await apiFetch(url, token);
            var body = await res.json();
            var items = body.data || [];
            return items.map(function (d) {
              var attrs = d.attributes || {};
              return { id: d.id, name: (d.id || '').split('/').pop() || d.id, size: attrs.size || 0, displayURL: attrs.url || '', path: d.id, url: attrs.url || '' };
            });
          };

          LaikaBackend.prototype.getMediaDisplayURL = async function (displayURL) {
            return typeof displayURL === 'string' ? displayURL : (displayURL.path || '');
          };

          LaikaBackend.prototype.getMediaFile = async function (path) {
            var token = this._token;
            var res = await apiFetch(this.apiUrl + '/assets/resources/' + encodeURIComponent(path), token);
            var body = await res.json();
            var attrs = (body.data && body.data.attributes) || {};
            var url = attrs.url || '';
            var name = path.split('/').pop() || path;
            return { id: path, name: name, size: attrs.size || 0, displayURL: url, path: path, url: url, file: new File([], name) };
          };

          LaikaBackend.prototype.persistMedia = async function (mediaFile, _options) {
            var token = this._token;
            var fileObj = mediaFile.fileObj;
            if (!fileObj) throw new Error('No file provided');
            var key = (mediaFile.path || '').split('/').pop() || mediaFile.path;
            var buf = await fileObj.arrayBuffer();
            var res = await fetch(this.apiUrl + '/assets/resources', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/vnd.api+json', 'Accept': 'application/vnd.api+json' },
              body: JSON.stringify({ data: { type: 'assets', attributes: { key: key, mimeType: fileObj.type || 'application/octet-stream', content: Array.from(new Uint8Array(buf)) } } }),
            });
            if (!res.ok) throw new Error('Upload failed: ' + res.status);
            var body = await res.json();
            var attrs = (body.data && body.data.attributes) || {};
            var url = attrs.url || '';
            return { id: key, name: key.split('/').pop() || key, size: fileObj.size, displayURL: url, path: key, url: url, file: fileObj };
          };

          LaikaBackend.prototype.deleteMedia = async function (path) {
            var token = this._token;
            try { await apiFetch(this.apiUrl + '/assets/resources/' + encodeURIComponent(path), token, { method: 'DELETE' }); } catch (e) { /* ignore */ }
          };

          LaikaBackend.prototype.unpublishedEntries = async function () { return []; };
          LaikaBackend.prototype.unpublishedEntry = async function () { throw new Error('Not supported'); };
          LaikaBackend.prototype.unpublishedEntryDataFile = async function () { return ''; };
          LaikaBackend.prototype.unpublishedEntryMediaFile = async function (_c, _s, path) { return this.getMediaFile(path); };
          LaikaBackend.prototype.updateUnpublishedEntryStatus = async function () {};
          LaikaBackend.prototype.deleteUnpublishedEntry = async function () {};
          LaikaBackend.prototype.publishUnpublishedEntry = async function () {};
          LaikaBackend.prototype.getDeployPreview = async function () { return null; };
          LaikaBackend.prototype.traverseCursor = async function (_cursor, _action) { return { entries: [], cursor: _cursor }; };

          return LaikaBackend;
        }

        var CMS = window.CMS;
        CMS.registerBackend('laika', createLaikaBackend());

        var baseUrl = ${baseUrlExpr};
        var devToken = ${tokenLiteral};
        var userConfig = ${serializedConfig};
        CMS.init({
          config: Object.assign({}, userConfig, {
            backend: Object.assign({}, userConfig.backend, {
              base_url: baseUrl,
              dev_token: devToken,
            }),
          }),
        });
      })();
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
