import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

/**
 * Cache root for auto-installed backend packages. Each pinned `<pkg>@<version>`
 * lives in its own subdirectory so concurrent migrations against different
 * versions don't collide.
 */
const CACHE_ROOT = path.join(os.homedir(), '.laika-cms', 'backends');

const flattenPackageName = (pkg: string): string => pkg.replace(/^@/, '').replace(/\//g, '__');

const cacheDirFor = (pkg: string, version: string): string =>
  path.join(CACHE_ROOT, `${flattenPackageName(pkg)}@${version}`);

/**
 * Try to dynamic-import `<pkg>/<subpath>` from the current process's module
 * resolution chain (i.e. the user's project). Resolves to the imported module
 * on success, `null` on `ERR_MODULE_NOT_FOUND` — every other failure is real
 * (syntax error in the package, exports map mismatch, etc.) and gets thrown.
 */
const tryLocalImport = async (
  pkg: string,
  subpath: string,
): Promise<Record<string, unknown> | null> => {
  const specifier = subpath === '.' ? pkg : `${pkg}/${subpath}`;
  try {
    return (await import(specifier)) as Record<string, unknown>;
  } catch (err) {
    if (isModuleNotFound(err)) return null;
    throw enrichResolveError(pkg, err);
  }
};

const isModuleNotFound = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
};

/**
 * Wrap an ESM resolution error with a hint pointing at the most common cause
 * we've seen: a downstream package whose TS build leaves directory imports
 * (`import './x'`) without explicit `.js` extensions. Node's runtime ESM
 * resolver rejects those; `tsc --moduleResolution NodeNext` (or `nodenext`)
 * fixes them at the source.
 */
const enrichResolveError = (pkg: string, err: unknown): Error => {
  if (!(err instanceof Error)) return new Error(String(err));
  const code = (err as { code?: string }).code;
  if (code === 'ERR_UNSUPPORTED_DIR_IMPORT') {
    return new Error(
      `laika-local: failed to import ${pkg}: ${err.message}\n`
        + `(this usually means the package's published dist contains a `
        + `bare directory import; rebuild it with moduleResolution "nodenext")`,
    );
  }
  return err;
};

/**
 * Try to import the package out of its dedicated cache directory. Uses Node's
 * resolver (via `createRequire`) so package `exports` maps are honored.
 */
const tryCacheImport = async (
  pkg: string,
  subpath: string,
  version: string,
): Promise<Record<string, unknown> | null> => {
  const dir = cacheDirFor(pkg, version);
  const anchor = path.join(dir, 'package.json');
  try {
    await fs.access(anchor);
  } catch {
    return null;
  }
  const req = createRequire(anchor);
  const specifier = subpath === '.' ? pkg : `${pkg}/${subpath}`;
  let resolved: string;
  try {
    resolved = req.resolve(specifier);
  } catch (err) {
    if (isModuleNotFound(err)) return null;
    throw enrichResolveError(pkg, err);
  }
  try {
    return (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  } catch (err) {
    throw enrichResolveError(pkg, err);
  }
};

/**
 * Confirm with the user that we may install a package and then run
 * `npm install --prefix <cacheDir> <pkg>@<version>` into the dedicated cache.
 * The prompt is honored only on a TTY; in non-interactive contexts (CI, piped
 * scripts) the call refuses to install and throws so the caller can either
 * abort the run or fall back to a different code path.
 */
const promptAndInstall = async (
  pkg: string,
  version: string,
  prompter: Prompter,
): Promise<void> => {
  const dir = cacheDirFor(pkg, version);
  const accepted = await prompter(
    `laika-local: backend "${pkg}@${version}" is not installed. Install it now into ${dir}? [y/N] `,
  );
  if (!accepted) {
    throw new Error(
      `laika-local: backend "${pkg}@${version}" is required but not installed. `
        + `Re-run and accept the install prompt, or install it manually with: `
        + `npm install ${pkg}@${version}`,
    );
  }

  await fs.mkdir(dir, { recursive: true });
  const pkgJson = path.join(dir, 'package.json');
  try {
    await fs.access(pkgJson);
  } catch {
    await fs.writeFile(
      pkgJson,
      JSON.stringify(
        { name: 'laika-cms-backend-cache', version: '0.0.0', private: true },
        null,
        2,
      ) + '\n',
      'utf8',
    );
  }

  process.stderr.write(`laika-local: installing ${pkg}@${version} into ${dir}...\n`);
  const result = spawnSync('npm', ['install', `${pkg}@${version}`, '--no-save', '--silent'], {
    cwd: dir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      `laika-local: failed to install ${pkg}@${version} (npm exit ${result.status}).`,
    );
  }
};

export type Prompter = (question: string) => Promise<boolean>;

/**
 * Default y/N prompter that reads from stdin. Yields `false` immediately when
 * stdin is not a TTY (CI, piped scripts) so non-interactive callers can decide
 * how to handle the missing backend.
 */
export const defaultPrompter: Prompter = async question => {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
};

export interface ResolveOptions {
  /** Custom prompter for the install confirmation. */
  readonly prompter?: Prompter;
  /** Skip the prompt and refuse to auto-install. Default: false. */
  readonly noInstall?: boolean;
}

/**
 * Resolve `<pkg>/<subpath>` to a module, falling back through
 *   1. the current process's module resolution chain (workspace, project deps),
 *   2. the dedicated per-pinned-version cache directory,
 *   3. a fresh `npm install` into the cache (after y/N confirmation).
 *
 * Built-in implementations (`packageName === 'laikacms'`) skip the install path
 * entirely — they always resolve through (1) because they ship with the same
 * package that hosts this CLI.
 */
export const resolveBackendPackage = async (
  pkg: string,
  subpath: string,
  version: string,
  options: ResolveOptions = {},
): Promise<Record<string, unknown>> => {
  const local = await tryLocalImport(pkg, subpath);
  if (local) return local;

  const cached = await tryCacheImport(pkg, subpath, version);
  if (cached) return cached;

  if (options.noInstall) {
    throw new Error(
      `laika-local: backend "${pkg}@${version}" is not installed and --no-install was passed.`,
    );
  }

  await promptAndInstall(pkg, version, options.prompter ?? defaultPrompter);

  const installed = await tryCacheImport(pkg, subpath, version);
  if (installed) return installed;

  throw new Error(
    `laika-local: ${pkg}@${version} installed but ${subpath} could not be imported.`,
  );
};
