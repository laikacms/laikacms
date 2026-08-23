/**
 * The Astro integration.
 *
 * Three jobs, none of which a loader can do on its own:
 *
 * 1. Serve Laika's JSON:API from the dev server, so the Decap admin can read
 *    and write your content locally.
 * 2. Turn a content change into a targeted `refreshContent()`, so an edit shows
 *    up without restarting the dev server.
 * 3. Emit the types Astro cannot infer.
 *
 * The dev API is Vite middleware, mounted from `astro:server:setup`. That hook
 * runs for `astro dev` and never for `astro build`, so the read-write dev API
 * cannot survive into a build *by construction* rather than by a runtime check.
 *
 * `api.mode: 'route'` is the separate, opt-in case: a real Astro route that
 * survives into an SSR deployment. It needs no authentication — the `laikacms`
 * sub-API builders take an `authorize` callback and nothing else — and defaults
 * to serving only published content, which is precisely what a built site
 * already gives away. See `api-access.ts` for why "the content is public" does
 * not extend to writes or to drafts.
 */

import path from 'node:path';

import { DEFAULT_LOCAL_API_BASE_PATH, mountLocalApi } from '@laikacms/vite-plugin';
import type { AstroIntegration } from 'astro';
import { runTask } from 'laikacms/compat';
import type { ChangeSummary, Unsubscribe } from 'laikacms/storage';
import type { ApiAccess } from './api-access.js';

import { jsonSchemaToTypeExpression } from './json-schema-to-types.js';
import { DEFAULT_BODY_FIELD, stripBodyField } from './mapping.js';
import {
  DEFAULT_CONTENT_DIR,
  type LaikaRepositories,
  type LaikaRepositoryOptions,
  resolveCatalogProvider,
  resolveRepositories,
} from './repositories.js';

export interface LaikaApiOptions {
  /** Where the JSON:API is mounted. Defaults to `/__laika`. */
  basePath?: string;
  /**
   * `'dev'` (default) serves the API from the dev server only, read-write, for
   * the CMS admin. It does not exist in a build.
   *
   * `'route'` additionally injects a real Astro route that survives into a
   * deployment. The route is rendered on demand, so the project needs an
   * adapter and `output: 'server'`.
   */
  mode?: 'dev' | 'route';
  /**
   * What the injected route exposes. Defaults to `'published'` — the content a
   * static build already ships, and nothing else. Ignored in `'dev'` mode,
   * which is always read-write and local-only.
   */
  access?: ApiAccess;
}

export interface LaikaRefreshOptions {
  /** Which loaders to refresh. Defaults to every loader. */
  loaders?: string[];
  /** How long to coalesce a burst of changes. Defaults to 50ms. */
  debounceMs?: number;
}

export interface LaikaIntegrationOptions extends LaikaRepositoryOptions {
  /**
   * Mount the unauthenticated JSON:API on the dev server, so the Decap admin
   * reads and writes your content locally. `true` (default) uses the defaults
   * in {@link LaikaApiOptions}. Never mounted in a build.
   */
  api?: boolean | LaikaApiOptions;
  /** Refresh content when the repository changes. `true` (default) enables it. */
  refresh?: boolean | LaikaRefreshOptions;
  /** Emit `.astro/integrations/@laikacms-astro/types.d.ts`. Defaults to `true`. */
  types?: boolean;
}

const DEFAULT_DEBOUNCE_MS = 50;

export function laika(options: LaikaIntegrationOptions = {}): AstroIntegration {
  const api = normalize(options.api, {});
  const refresh = normalize(options.refresh, {});

  let repositories: LaikaRepositories | undefined;
  let root = process.cwd();
  let unsubscribe: Unsubscribe | undefined;

  const repos = (): LaikaRepositories => {
    repositories ??= resolveRepositories(options, root);
    return repositories;
  };

  return {
    name: '@laikacms/astro',
    hooks: {
      'astro:config:setup': ({ config, addWatchFile, injectRoute, updateConfig, logger }) => {
        root = config.root.pathname;

        // The Decap config describes the collections, so editing it changes the
        // shape of the content. It is a real file, so Astro can watch it and
        // restart — which is the only way a catalog change takes effect.
        if (options.dir !== undefined || options.storage === undefined) {
          for (const name of ['config.yml', 'config.yaml']) {
            addWatchFile(path.join(root, options.dir ?? 'content', name));
          }
        }

        if (api === false || api.mode !== 'route') return;

        const basePath = api.basePath ?? DEFAULT_LOCAL_API_BASE_PATH;
        // The route runs in the SSR bundle, a different module graph — a live
        // repository object cannot cross that boundary, only the options that
        // rebuild one. A caller who constructed their own repository is better
        // served writing the four-line route themselves.
        if (options.repositories !== undefined || options.storage !== undefined) {
          throw new Error(
            '@laikacms/astro: api.mode "route" builds its repositories inside the server bundle, '
              + 'so it cannot use a `repositories` or `storage` instance created in astro.config. '
              + 'Either configure the route with `dir`/`catalog`, or write the route yourself:\n\n'
              + '  // src/pages' + basePath + '/[...path].ts\n'
              + "  import { createApiHandler } from '@laikacms/astro/api';\n"
              + '  const handler = createApiHandler({ repositories, basePath: ' + JSON.stringify(basePath)
              + " , access: 'published' });\n"
              + '  export const prerender = false;\n'
              + '  export const ALL = ({ request }) => handler(request);',
          );
        }

        updateConfig({ vite: { plugins: [apiConfigPlugin(options, api, root)] } });
        injectRoute({
          pattern: `${basePath}/[...path]`,
          entrypoint: '@laikacms/astro/api-route',
          prerender: false,
        });
        logger.info(
          `Laika JSON:API route at ${basePath} (access: ${api.access ?? 'published'}).`,
        );
      },

      'astro:config:done': async ({ buildOutput, injectTypes, logger }) => {
        if (api !== false && api.mode === 'route' && buildOutput === 'static') {
          // Astro would otherwise fail deep in the build with NoAdapterInstalled,
          // naming a route the user never wrote. Failing here names the option.
          throw new Error(
            '@laikacms/astro: api.mode "route" needs an on-demand rendered route, but this project '
              + 'builds to static output. Install an adapter and set output: "server", or drop '
              + 'api.mode to serve the API from the dev server only.',
          );
        }

        if (options.types === false) return;
        injectTypes({ filename: 'types.d.ts', content: TYPES });
        logger.debug('Emitted Laika types.');

        const live = await liveCollectionTypes(options, repos(), logger);
        if (live !== undefined) {
          injectTypes({ filename: 'live-collections.d.ts', content: live });
          logger.debug('Emitted Laika live-collection types.');
        }
      },

      'astro:server:setup': ({ server, logger, refreshContent }) => {
        if (api !== false) {
          const basePath = api.basePath ?? DEFAULT_LOCAL_API_BASE_PATH;
          mountLocalApi(server, repos(), { basePath });
          logger.info(`Laika JSON:API mounted at ${basePath}`);
        }

        if (refresh === false) return;
        if (!refreshContent) {
          logger.warn('This Astro version does not expose refreshContent; content will not hot-reload.');
          return;
        }

        unsubscribe = subscribe(repos(), refresh, changes => {
          void refreshContent({
            ...(refresh.loaders !== undefined ? { loaders: refresh.loaders } : {}),
            context: { laika: { changes } },
          });
        }, logger);
      },

      'astro:server:done': () => {
        unsubscribe?.();
        unsubscribe = undefined;
      },
    },
  };
}

/** `true` / `undefined` mean "on with defaults"; `false` means off. */
function normalize<T extends object>(value: boolean | T | undefined, defaults: T): T | false {
  if (value === false) return false;
  if (value === true || value === undefined) return defaults;
  return value;
}

/**
 * Bridge the repository's push channel to `refreshContent`.
 *
 * Debounced because a single editor save can produce several filesystem events,
 * and each `refreshContent` re-runs every loader.
 */
function subscribe(
  repositories: LaikaRepositories,
  options: LaikaRefreshOptions,
  emit: (changes: ChangeSummary[]) => void,
  logger: { warn(message: string): void },
): Unsubscribe | undefined {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let pending = new Map<string, ChangeSummary>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return repositories.storage.subscribeChanges({}, changes => {
      // Keyed, so a burst that touches the same file repeatedly collapses to
      // its last state rather than replaying every intermediate write.
      for (const change of changes) pending.set(change.key, change);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const batch = [...pending.values()];
        pending = new Map();
        if (batch.length > 0) emit(batch);
      }, debounceMs);
    });
  } catch {
    // Repositories without a push channel throw NotImplementedError from the
    // base class. Those projects simply do not hot-reload; that is not an error
    // worth failing the dev server over.
    logger.warn(
      'This storage repository does not support change subscriptions, so content will not '
        + 'hot-reload. Restart the dev server to pick up changes.',
    );
    return undefined;
  }
}

/**
 * Type the live collections from the catalog.
 *
 * A build-time loader gets `entry.data` typed through Astro's `createSchema()`.
 * A live loader has no equivalent hook — its data type comes only from the
 * `LiveLoader` generic — so the types have to be written somewhere the checker
 * will find them, and this is that write. See `live-collections.ts` for why the
 * augmentation targets that exact module specifier.
 *
 * Returns `undefined` when there is nothing to say, which is the common case
 * for the default convention catalog: it reports only collections that have
 * been persisted, and describes their fields permissively. Emitting an empty
 * augmentation would be harmless but misleading in `.astro/`.
 */
async function liveCollectionTypes(
  options: LaikaIntegrationOptions,
  repositories: LaikaRepositories,
  logger: { debug(message: string): void },
): Promise<string | undefined> {
  let members: string[];
  try {
    const catalog = resolveCatalogProvider(
      options.catalog ?? 'convention',
      repositories.storage,
      options.configKey,
    );
    const { collections } = await runTask(catalog.getCatalog());

    members = [];
    for (const [name, settings] of Object.entries(collections ?? {})) {
      if (settings.type !== 'document') continue;

      const schema = await runTask(catalog.getCollectionSchema(name)).catch(() => undefined);
      // No fields is not a failure — it is a catalog that cannot describe this
      // collection. Leaving it out of the interface is what makes the loader
      // fall back to `Record<string, unknown>` for it.
      if (schema === undefined || Object.keys(schema.properties ?? {}).length === 0) continue;

      // The body field never reaches `data` — the live loader splits prose out
      // exactly as the build-time one does. `render.bodyField` is a per-loader
      // option the integration cannot see, so a project that renames it must
      // augment the interface itself.
      const body = jsonSchemaToTypeExpression(stripBodyField(schema, DEFAULT_BODY_FIELD), {
        depth: 2,
        // Nothing coerces on the live path unless that loader opted into
        // validation, and this one interface is shared by every loader.
        dateType: 'string | Date',
      });
      members.push(`    ${propertyName(name)}: ${body};`);
    }
  } catch (error) {
    // A catalog that cannot be read is not a reason to fail the build. Without
    // the augmentation every live collection is `Record<string, unknown>`,
    // which is exactly where this package started.
    logger.debug(`Could not read the catalog for live-collection types: ${String(error)}`);
    return undefined;
  }

  if (members.length === 0) return undefined;

  return `declare module '@laikacms/astro/live-collections' {\n`
    + `  /**\n`
    + `   * Generated by @laikacms/astro from the Laika catalog — do not edit;\n`
    + `   * change your CMS config instead. Augment this module in your own code\n`
    + `   * to override a collection whose widgets resolved to \`unknown\`.\n`
    + `   */\n`
    + `  interface LaikaLiveCollections {\n`
    + `${members.join('\n')}\n`
    + `  }\n`
    + `}\n`;
}

/** Quote a collection key that is not a valid bare identifier. */
function propertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

const TYPES = `declare module '@laikacms/astro' {
  /**
   * Extra data the Laika integration attaches to a content refresh. Loaders
   * read it to apply exactly the keys that changed.
   */
  interface LaikaRefreshContext {
    changes: Array<{ key: string, deleted: boolean }>;
  }
}
`;

/**
 * Serve the route's configuration as a virtual module.
 *
 * `injectRoute` takes a module path, so this is the channel through which the
 * injected entrypoint learns what to serve. Only serialisable options cross —
 * see the guard in `astro:config:setup`.
 */
function apiConfigPlugin(
  options: LaikaIntegrationOptions,
  api: LaikaApiOptions,
  root: string,
): { name: string, resolveId(id: string): string | undefined, load(id: string): string | undefined } {
  const virtualId = 'virtual:@laikacms/astro/api';
  const resolvedId = `\0${virtualId}`;

  const config = {
    dir: options.dir ?? DEFAULT_CONTENT_DIR,
    root,
    ...(options.defaultExtension !== undefined ? { defaultExtension: options.defaultExtension } : {}),
    ...(typeof options.catalog === 'string' ? { catalog: options.catalog } : {}),
    ...(options.configKey !== undefined ? { configKey: options.configKey } : {}),
    basePath: api.basePath ?? DEFAULT_LOCAL_API_BASE_PATH,
    access: api.access ?? 'published',
  };

  return {
    name: '@laikacms/astro:api-config',
    resolveId: id => (id === virtualId ? resolvedId : undefined),
    load: id =>
      id === resolvedId
        ? `import { createApiHandler } from '@laikacms/astro/api';\n`
          + `import { resolveRepositories } from '@laikacms/astro';\n`
          + `const config = ${JSON.stringify(config)};\n`
          + `export const handler = createApiHandler({\n`
          + `  repositories: resolveRepositories(config, config.root),\n`
          + `  basePath: config.basePath,\n`
          + `  access: config.access,\n`
          + `});\n`
        : undefined,
  };
}
