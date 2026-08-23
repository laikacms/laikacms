/**
 * The repository slot shared by the integration and both build-time loaders.
 *
 * The field names mirror `LaikaVitePluginOptions` exactly. That is deliberate:
 * a reader who has wired the Vite plugin already knows this struct, and the two
 * packages can grow the same new option without diverging.
 *
 * Astro loads `astro.config.mjs` and `src/content.config.ts` in separate Vite
 * module registries, so a module-level singleton constructed by the integration
 * is not visible to a loader. Loaders therefore build their own instance from
 * the same options. That is harmless for the default filesystem repository,
 * which holds no read state — and it is what makes the zero-config path work.
 * Projects on an expensive or remote repository should export one instance from
 * a project module and pass it to both.
 */

import path from 'node:path';

import { createFsStorage, createRepositories, defaultSerializers, type LaikaRepositories } from '@laikacms/vite-plugin';
import { AssetsRepository } from 'laikacms/assets';
import { CatalogAssetsRepository } from 'laikacms/assets/catalog';
import type { CatalogProvider } from 'laikacms/catalog';
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';
import { DecapCatalogProvider } from 'laikacms/catalog-decap';
import { CatalogDocumentsRepository } from 'laikacms/documents/catalog';
import type { StorageRepository, StorageSerializerRegistry } from 'laikacms/storage';

export type { LaikaRepositories };
export { defaultSerializers };

/**
 * Which catalog describes the collections.
 *
 * - `'convention'` (default) — a collection is a top-level directory, and its
 *   key is its name. Zero configuration, and correct for any project whose
 *   Decap `folder` matches its collection `name`.
 * - `'decap'` — read `config.yml`. Necessary when a collection's `folder`
 *   differs from its `name`, and the only option that can *enumerate* the
 *   collections, which is what {@link laikaCollections} needs.
 * - a `CatalogProvider` — anything else.
 */
export type CatalogChoice = 'convention' | 'decap' | CatalogProvider;

/** Where the Decap config lives, relative to the storage root. Extension is probed. */
export const DEFAULT_CONFIG_KEY = 'config';

export interface LaikaRepositoryOptions {
  /**
   * Bring your own repositories. Highest precedence — nothing else in this
   * struct is read when it is set.
   */
  repositories?: LaikaRepositories;
  /**
   * Provide only the storage repository; the documents and assets repositories
   * are derived from it via Catalog. Ignored when {@link repositories} is given.
   */
  storage?: StorageRepository;
  /**
   * Directory the default filesystem repository reads, resolved relative to the
   * Astro project root. Ignored when {@link storage} or {@link repositories} is
   * given. Defaults to `'content'`.
   */
  dir?: string;
  /** File extension applied to keys without one. Defaults to `'json'`. */
  defaultExtension?: string;
  /** Serializer registry for the default filesystem repository. */
  serializers?: StorageSerializerRegistry;
  /**
   * Which catalog maps a collection to a directory. Defaults to
   * `'convention'`. Ignored when {@link repositories} is given.
   */
  catalog?: CatalogChoice;
  /** Where the Decap config lives, for `catalog: 'decap'`. Defaults to `'config'`. */
  configKey?: string;
}

/** The directory the default filesystem repository reads when none is given. */
export const DEFAULT_CONTENT_DIR = 'content';

/**
 * Resolve a {@link LaikaRepositoryOptions} into concrete repositories.
 *
 * `root` is the Astro project root (`config.root`), used to resolve a relative
 * {@link LaikaRepositoryOptions.dir}. Loaders that run outside a configured
 * integration pass `process.cwd()`, which is where Astro is invoked from.
 */
export function resolveRepositories(
  options: LaikaRepositoryOptions,
  root: string,
): LaikaRepositories {
  if (options.repositories) return options.repositories;

  const storage = options.storage ?? createFsStorage({
    dir: path.resolve(root, options.dir ?? DEFAULT_CONTENT_DIR),
    ...(options.defaultExtension !== undefined ? { defaultExtension: options.defaultExtension } : {}),
    ...(options.serializers !== undefined ? { serializers: options.serializers } : {}),
  });

  // `createRepositories` from the Vite plugin hardwires the convention
  // provider, which is right for the common case but cannot express a Decap
  // collection whose `folder` differs from its `name`.
  const choice = options.catalog ?? 'convention';
  if (choice === 'convention') return createRepositories(storage);

  const catalog = resolveCatalogProvider(choice, storage, options.configKey);
  return {
    storage,
    documents: new CatalogDocumentsRepository(storage, catalog),
    assets: new CatalogAssetsRepository(storage, catalog) as AssetsRepository,
  };
}

/** Turn a {@link CatalogChoice} into a provider over `storage`. */
export function resolveCatalogProvider(
  choice: CatalogChoice,
  storage: StorageRepository,
  configKey?: string,
): CatalogProvider {
  if (choice === 'convention') return new ConventionCatalogProvider({ storage });
  if (choice === 'decap') {
    return new DecapCatalogProvider({ storage, configKey: configKey ?? DEFAULT_CONFIG_KEY });
  }
  return choice;
}
