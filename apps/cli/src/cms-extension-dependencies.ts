import { readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { init, parse } from 'es-module-lexer';
import { resolve } from 'import-meta-resolve';

export interface DiscoverOptionalPeerDependenciesOptions {
  readonly projectDirectory: string;
  readonly packageName: string;
  readonly extensionSubpaths: readonly string[];
}

interface PackageJson {
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

/**
 * Find missing optional peers used by the selected extension module graphs.
 * Runtime modules are parsed as source text and are never evaluated.
 */
export async function discoverOptionalPeerDependencies(
  options: DiscoverOptionalPeerDependenciesOptions,
): Promise<Record<string, string>> {
  const requireFromProject = createRequire(path.join(options.projectDirectory, 'package.json'));
  const packageJsonPath = requireFromProject.resolve(`${options.packageName}/package.json`);
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as PackageJson;
  const projectPackageJson = JSON.parse(
    await readFile(path.join(options.projectDirectory, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
  const declaredDependencies = declaredPackageNames(projectPackageJson);
  const optionalPeers = new Set(
    Object.entries(packageJson.peerDependenciesMeta ?? {})
      .filter(([, metadata]) => metadata.optional === true)
      .map(([name]) => name),
  );
  const externalImports = new Set<string>();
  const visited = new Set<string>();

  await init;
  for (const subpath of options.extensionSubpaths) {
    const specifier = `${options.packageName}/${subpath.replace(/^\.\//, '')}`;
    const entrypoint = fileURLToPath(
      resolve(specifier, pathToFileURL(path.join(options.projectDirectory, 'package.json')).href),
    );
    await scanModule(entrypoint, visited, externalImports);
  }

  const missing: Record<string, string> = {};
  for (const name of [...externalImports].sort()) {
    if (
      !optionalPeers.has(name)
      || declaredDependencies.has(name)
      || await isInstalled(options.projectDirectory, name)
    ) continue;
    const version = packageJson.peerDependencies?.[name];
    if (!version) {
      throw new Error(
        `${options.packageName} imports optional peer "${name}" but does not declare its version`,
      );
    }
    missing[name] = version;
  }
  return missing;
}

/** Add missing selected-extension peers to an application's dependencies. */
export async function synchronizeOptionalPeerDependencies(
  options: DiscoverOptionalPeerDependenciesOptions,
): Promise<string[]> {
  const discovered = await discoverOptionalPeerDependencies(options);
  const added = Object.keys(discovered);
  if (added.length === 0) return [];

  const packageJsonPath = path.join(options.projectDirectory, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
  const dependencies = isStringRecord(packageJson.dependencies) ? packageJson.dependencies : {};
  packageJson.dependencies = { ...dependencies, ...discovered };
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  return added;
}

async function scanModule(
  filePath: string,
  visited: Set<string>,
  externalImports: Set<string>,
): Promise<void> {
  const cleanPath = stripQuery(filePath);
  if (visited.has(cleanPath)) return;
  visited.add(cleanPath);

  const source = await readFile(cleanPath, 'utf8');
  const [imports] = parse(source);
  for (const imported of imports) {
    if (!imported.n) continue;
    const specifier = stripQuery(imported.n);
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const resolved = await resolveRelativeModule(path.dirname(cleanPath), specifier);
      if (resolved) await scanModule(resolved, visited, externalImports);
      continue;
    }
    if (specifier.startsWith('node:') || specifier.startsWith('data:')) continue;
    externalImports.add(packageNameFromSpecifier(specifier));
  }
}

const stripQuery = (value: string): string => value.split(/[?#]/, 1)[0];

const packageNameFromSpecifier = (specifier: string): string => {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

async function resolveRelativeModule(directory: string, specifier: string): Promise<string | undefined> {
  const target = path.resolve(directory, specifier);
  const candidates = path.extname(target)
    ? [target]
    : [target, `${target}.js`, `${target}.mjs`, `${target}.cjs`, path.join(target, 'index.js')];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next ESM resolution candidate.
    }
  }
  return undefined;
}

const isInstalled = async (projectDirectory: string, packageName: string): Promise<boolean> => {
  try {
    resolve(packageName, pathToFileURL(path.join(projectDirectory, 'package.json')).href);
    return true;
  } catch {
    return false;
  }
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object'
  && value !== null
  && Object.values(value).every(item => typeof item === 'string');

const declaredPackageNames = (packageJson: Record<string, unknown>): Set<string> => {
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  return new Set(
    sections.flatMap(section => isStringRecord(packageJson[section]) ? Object.keys(packageJson[section]) : []),
  );
};
