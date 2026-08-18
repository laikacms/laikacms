/**
 * Shared logic for keeping starters/ pinned to the current LaikaCMS releases.
 *
 * Starters under starters/ are download-and-go: a user copies the folder and
 * runs `npm install`, so their package.json must reference PUBLISHED semver
 * ranges — never workspace:/catalog:/link:/file: protocols, which only resolve
 * inside this monorepo. To keep those ranges honest, every dependency that
 * names a workspace package (laikacms, @laikacms/*) is rewritten to a caret
 * range against that package's current version.
 *
 * `sync-starter-versions.mjs` applies the rewrites (run from the `version`
 * script, after `changeset version` bumps the packages). `check-starter-
 * versions.mjs` asserts they are already in sync and carry no workspace
 * protocols (CI guard). Both import from here.
 *
 * Version sources:
 *   workspaceVersions()   — reads packages/ on disk; use for sync (pre-publish)
 *   npmPublishedVersions() — queries the npm registry; use for the CI guard
 *     (starters must be installable, not just match the in-progress workspace)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const WORKSPACE_PROTOCOLS = ['workspace:', 'catalog:', 'link:', 'file:'];

/**
 * Query npm for the latest published version of each package in `workspaceMap`.
 * Falls back to the workspace version for packages not yet on the registry
 * (brand-new packages that have never been published).
 */
export function npmPublishedVersions(workspaceMap) {
  const result = { ...workspaceMap };
  for (const name of Object.keys(workspaceMap)) {
    try {
      const version = execFileSync('npm', ['view', name, 'version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (version) result[name] = version;
    } catch {
      // Package not yet published — keep workspace version as fallback.
    }
  }
  return result;
}

/** Map of every publishable workspace package name → its current version. */
export function workspaceVersions() {
  const packagesDir = join(repoRoot, 'packages');
  const versions = {};
  for (const name of readdirSync(packagesDir)) {
    const pkgPath = join(packagesDir, name, 'package.json');
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.name && pkg.version) versions[pkg.name] = pkg.version;
    } catch {
      // Not a package directory — skip.
    }
  }
  return versions;
}

/** Absolute paths to every starters/<name>/package.json. */
export function starterPackageJsonPaths() {
  const startersDir = join(repoRoot, 'starters');
  const paths = [];
  for (const name of readdirSync(startersDir)) {
    const pkgPath = join(startersDir, name, 'package.json');
    try {
      if (statSync(pkgPath).isFile()) paths.push(pkgPath);
    } catch {
      // No package.json in this entry — skip.
    }
  }
  return paths;
}

/**
 * Inspect one starter package.json against the workspace versions.
 * Returns { rewrites, protocols } where `rewrites` are workspace deps whose
 * range should change, and `protocols` are any disallowed workspace-protocol
 * ranges (which a starter must never ship).
 */
export function inspectStarter(pkgPath, versions) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const rewrites = [];
  const protocols = [];
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== 'string') continue;
      if (WORKSPACE_PROTOCOLS.some(p => range.startsWith(p))) {
        protocols.push({ field, name, range });
      }
      if (name in versions) {
        const want = `^${versions[name]}`;
        if (range !== want) rewrites.push({ field, name, from: range, to: want });
      }
    }
  }
  return { pkg, pkgPath, rewrites, protocols };
}

/** Apply the desired caret ranges to a parsed pkg; returns the new JSON text. */
export function applyRewrites(pkg, versions) {
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (name in versions) deps[name] = `^${versions[name]}`;
    }
  }
  return JSON.stringify(pkg, null, 2) + '\n';
}
