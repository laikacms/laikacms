import type { StorageRepository } from 'laikacms/storage';

/**
 * A backend driver is the thin adapter between a user-facing config blob and a
 * concrete repository implementation. Each driver:
 *   - declares which npm package + subpath supplies the implementation,
 *   - declares the pinned version it is tested against (auto-installed on
 *     demand when the package can't be resolved locally),
 *   - exposes a `build` function that takes a plain JSON-shaped options object
 *     (whatever came off the CLI or out of the config file) and returns a
 *     constructed repository.
 *
 * The `module` parameter handed to `build` is the dynamically-imported package
 * subpath — the same object you'd get from
 * `await import('@laikacms/vercel/storage-blob')`. Drivers read the constructor
 * (and any helpers like data sources) off this object.
 */
export interface StorageDriver {
  /** Short identifier used in CLI flags and config files. e.g. 'fs'. */
  readonly name: string;
  /**
   * NPM package the implementation lives in. e.g. '@laikacms/vercel'. Use
   * `'laikacms'` for built-in implementations that ship as part of the core
   * package; they always resolve and never trigger an install prompt.
   */
  readonly packageName: string;
  /**
   * Pinned version installed when the package can't be resolved. Devs working
   * inside the monorepo never hit the install path because workspace packages
   * resolve first.
   */
  readonly version: string;
  /**
   * Subpath inside the package to import. e.g. 'storage-blob'. Pass '.' for
   * the root export.
   */
  readonly subpath: string;
  /**
   * One-line description shown by `laika-local migrate list-backends`.
   */
  readonly description: string;
  /**
   * Construct a {@link StorageRepository} from the user's options blob and the
   * dynamically-imported module. Implementations should validate required
   * fields and throw `Error` with a helpful message when something is missing.
   */
  build(options: Record<string, unknown>, module: Record<string, unknown>): StorageRepository;
}

/**
 * One side of a migration: which driver to use and the options to feed it.
 * Shows up in config files as `{ "backend": "vercel", "options": {...} }`.
 */
export interface BackendSpec {
  readonly backend: string;
  readonly options: Record<string, unknown>;
}

/**
 * Top-level config-file shape. `migrate` carries the same options the CLI flags
 * accept (overwrite, dry-run, concurrency, etc.) so a single file can describe
 * the entire run.
 */
export interface MigrateConfig {
  readonly source: BackendSpec;
  readonly destination: BackendSpec;
  readonly migrate?: {
    readonly from?: string,
    readonly overwrite?: boolean,
    readonly dryRun?: boolean,
    readonly pageSize?: number,
    readonly concurrency?: number,
  };
}
