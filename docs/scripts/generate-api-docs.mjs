#!/usr/bin/env node
/**
 * Prebuild step: generates the TypeScript API reference for every published package under
 * `packages/` (`laikacms`, `@laikacms/github`, ...) from source with TypeDoc
 * (typedoc-plugin-markdown + typedoc-vitepress-theme).
 *
 * Entry points are derived from each package's `package.json` `exports`, so every public
 * subpath gets a page and nothing private does. Each module is named after its import
 * specifier (`laikacms/storage/fs`, `@laikacms/github/storage-gh`, ...) rather than its
 * source path.
 *
 * All packages go through one TypeDoc run on a tsconfig that extends the core package's, so
 * its `paths` resolve `laikacms/*` imports in the other packages to core source and their
 * signatures link to the core pages instead of to `dist` declarations.
 *
 * Output is fully generated and gitignored — never hand-edit it:
 *   - docs/reference/api/**                      (markdown pages)
 *   - docs/reference/api/typedoc-sidebar.json    (sidebar data for config.ts)
 *
 * Invoked by the docs package's `dev`/`build` scripts. Can also be run directly:
 * `node scripts/generate-api-docs.mjs`.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Application, Converter, ReflectionKind } from 'typedoc';

/** The core package: its tsconfig is the base for the combined program. */
const CORE_PACKAGE = 'laikacms';

/**
 * Maps each `exports` subpath to its TypeScript source file, using the `types` target
 * (`./dist/x/index.d.ts` -> `src/x/index.ts`).
 *
 * @param {string} packageDir
 * @returns {Map<string, string>} absolute source path -> import specifier
 */
export function entryPointsFromExports(packageDir) {
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const entries = new Map();
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    const types = typeof target === 'string' ? target : target?.types;
    if (!types || subpath.includes('*') || !types.endsWith('.d.ts')) continue;
    const source = resolve(packageDir, types.replace(/^\.\/dist\//, 'src/').replace(/\.d\.ts$/, '.ts'));
    const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
    // Several subpaths alias the same file (`storage/fs` and `storage-fs`); the first listed wins.
    if (!entries.has(source)) entries.set(source, specifier);
  }
  return entries;
}

/**
 * Collects entry points across every published package directly under `packagesDir`.
 * Private packages and packages without `exports` are skipped.
 *
 * @param {string} packagesDir
 * @returns {Map<string, string>} absolute source path -> import specifier
 */
export function entryPointsFromPackages(packagesDir) {
  const entries = new Map();
  for (const name of readdirSync(packagesDir).sort()) {
    const packageDir = join(packagesDir, name);
    const manifest = join(packageDir, 'package.json');
    if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, 'utf8')).private) continue;
    for (const [source, specifier] of entryPointsFromExports(packageDir)) entries.set(source, specifier);
  }
  return entries;
}

/**
 * Writes a throwaway tsconfig that extends the core package's and includes every package's
 * source. Returns its path and a cleanup function.
 */
function writeCombinedTsconfig(packagesDir) {
  const dir = mkdtempSync(join(tmpdir(), 'laika-api-docs-'));
  const file = join(dir, 'tsconfig.json');
  writeFileSync(
    file,
    JSON.stringify({
      extends: join(packagesDir, CORE_PACKAGE, 'tsconfig.json'),
      compilerOptions: { rootDir: packagesDir, noEmit: true },
      include: [join(packagesDir, '*', 'src', '**', '*')],
      exclude: ['**/dist/**', '**/node_modules/**', '**/*.test.ts', '**/__tests__/**'],
    }),
  );
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function generateApiDocs({ packagesDir, docsRoot }) {
  const entries = entryPointsFromPackages(packagesDir);
  const tsconfig = writeCombinedTsconfig(packagesDir);
  const out = join(docsRoot, 'reference', 'api');
  rmSync(out, { recursive: true, force: true });

  const app = await Application.bootstrapWithPlugins({
    entryPoints: [...entries.keys()],
    tsconfig: tsconfig.file,
    plugin: ['typedoc-plugin-markdown', 'typedoc-vitepress-theme'],
    out,
    docsRoot,
    name: 'TypeScript API',
    readme: 'none',
    entryFileName: 'index',
    // Rollup can't resolve page paths containing `@`; module titles keep the scope.
    excludeScopesInPaths: true,
    excludePrivate: true,
    excludeInternal: true,
    excludeExternals: true,
    disableSources: true,
    hidePageHeader: true,
    useCodeBlocks: true,
    // JSDoc prose like `ReadableStream<Uint8Array>` would otherwise be parsed as a Vue tag.
    sanitizeComments: true,
    expandObjects: false,
    parametersFormat: 'table',
    sidebar: { autoConfiguration: true, format: 'vitepress', pretty: true, collapsed: true },
    // Source is type-checked by the package's own build; don't let docs generation fail on it.
    skipErrorChecking: true,
    validation: { notExported: false, invalidLink: true, rewrittenLink: true },
    logLevel: 'Warn',
  });

  // Name modules by their import specifier instead of their path under src/.
  app.converter.on(Converter.EVENT_CREATE_DECLARATION, (context, reflection) => {
    if (!reflection.kindOf(ReflectionKind.Module)) return;
    const symbol = context.getSymbolFromReflection(reflection);
    const file = symbol?.declarations?.[0]?.getSourceFile().fileName;
    const specifier = file && entries.get(resolve(file));
    if (specifier) reflection.name = specifier;
  });

  let project;
  try {
    project = await app.convert();
  } finally {
    tsconfig.cleanup();
  }
  if (!project) throw new Error('[generate-api-docs] TypeDoc conversion failed');
  await app.generateOutputs(project);
  if (app.logger.hasErrors()) throw new Error('[generate-api-docs] TypeDoc reported errors');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  await generateApiDocs({ packagesDir: resolve(docsRoot, '..', 'packages'), docsRoot });
}
