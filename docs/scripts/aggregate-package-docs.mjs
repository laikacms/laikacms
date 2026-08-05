#!/usr/bin/env node
/**
 * Prebuild step (LCMS-454): aggregates package-local reference/usage docs
 * (`packages/<pkg>/docs/**`) into the VitePress source tree under
 * `docs/reference/packages/<pkg>/**`, and writes the generated Reference >
 * Packages sidebar data consumed by `docs/.vitepress/config.ts`.
 *
 * Convention (see docs/contributing/package-docs.md):
 *   - Package docs live in `packages/<pkg>/docs/**.md`.
 *   - Every markdown file needs frontmatter `title`.
 *   - `packages/<pkg>/docs/index.md` is the package's landing page; its
 *     frontmatter `order` (number) controls the package's position in the
 *     generated sidebar (default: alphabetical by package name).
 *   - Other pages support `order` too, for ordering within a package.
 *   - Non-markdown files (images, etc.) are copied as-is so relative asset
 *     links keep resolving after relocation.
 *   - URL scheme: `/reference/packages/<pkg>/<page>` (index.md -> the
 *     package's own `/reference/packages/<pkg>/`).
 *
 * Output is fully generated and gitignored — never hand-edit it:
 *   - docs/reference/packages/<pkg>/**              (aggregated docs)
 *   - docs/.vitepress/generated/package-sidebar.json (sidebar data)
 *
 * Idempotent: the output directories are wiped and rebuilt from scratch on
 * every run, and page ordering is deterministic, so re-running against
 * unchanged input produces byte-identical output.
 *
 * Invoked by the docs package's `dev`/`build` scripts, which always run this
 * first. Can also be run directly: `node scripts/aggregate-package-docs.mjs`.
 */
import matter from 'gray-matter';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * @param {string} dir
 * @returns {string[]} package folder names directly under `dir` that contain a `docs/` folder
 */
function findPackagesWithDocs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => existsSync(join(dir, name, 'docs')))
    .sort();
}

/** @param {string} dir @returns {string[]} every file path relative to `dir` */
function listFilesRecursive(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(relative(dir, entry.parentPath ?? entry.path), entry.name).split(sep).join('/'));
}

/** @param {string} relPath e.g. "index.md" or "widgets/foo.md" -> route without extension, "" for index */
function toRoute(relPath) {
  const withoutExt = relPath.replace(/\.md$/, '');
  return withoutExt === 'index' ? '' : withoutExt.replace(/\/index$/, '/');
}

function isRelativeLink(target) {
  if (!target || target.startsWith('#')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false; // scheme:// links (http, mailto, ...)
  if (target.startsWith('/')) return false; // site-absolute — not this package's concern
  return true;
}

/**
 * @param {{ packagesDir: string, docsRoot: string }} options
 *   packagesDir — absolute path to the `packages/` directory to scan
 *   docsRoot    — absolute path to the VitePress docs source root (contains `.vitepress/`)
 */
export function aggregatePackageDocs({ packagesDir, docsRoot }) {
  const outDocsDir = join(docsRoot, 'reference', 'packages');
  const outGeneratedDir = join(docsRoot, '.vitepress', 'generated');
  const outSidebarFile = join(outGeneratedDir, 'package-sidebar.json');

  rmSync(outDocsDir, { recursive: true, force: true });
  rmSync(outGeneratedDir, { recursive: true, force: true });
  mkdirSync(outDocsDir, { recursive: true });
  mkdirSync(outGeneratedDir, { recursive: true });

  const packageNames = findPackagesWithDocs(packagesDir);
  const packageEntries = [];
  let pageCount = 0;

  for (const pkgFolder of packageNames) {
    const srcDir = join(packagesDir, pkgFolder, 'docs');
    const destDir = join(outDocsDir, pkgFolder);
    const files = listFilesRecursive(srcDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    if (mdFiles.length === 0) {
      console.warn(`[aggregate-package-docs] ${pkgFolder}/docs has no markdown files, skipping`);
      continue;
    }

    // Copy everything (markdown + assets) so relative asset links keep resolving.
    cpSync(srcDir, destDir, { recursive: true });

    const knownFiles = new Set(files);
    let pkgTitle = pkgFolder;
    let pkgOrder = Number.POSITIVE_INFINITY;
    const pages = [];

    for (const relPath of mdFiles.sort()) {
      const raw = readFileSync(join(srcDir, relPath), 'utf8');
      const { data: frontmatter, content } = matter(raw);

      if (!frontmatter.title || typeof frontmatter.title !== 'string') {
        throw new Error(
          `[aggregate-package-docs] ${pkgFolder}/docs/${relPath} is missing required frontmatter "title"`,
        );
      }

      // Fail loud on same-package relative links/assets that don't resolve. Links that escape
      // this package's docs tree (e.g. to another package or to central docs/) are left for
      // VitePress's own dead-link check to validate against the fully aggregated site.
      for (const match of content.matchAll(LINK_RE)) {
        const target = match[1].split('#')[0];
        if (!isRelativeLink(target) || target === '') continue;
        const resolved = relative(srcDir, resolve(dirname(join(srcDir, relPath)), target)).split(sep).join('/');
        if (resolved.startsWith('..')) continue; // escapes this package's docs tree
        if (!knownFiles.has(resolved) && !knownFiles.has(`${resolved}.md`)) {
          throw new Error(
            `[aggregate-package-docs] ${pkgFolder}/docs/${relPath} links to "${target}", `
              + `which does not resolve to a file under packages/${pkgFolder}/docs/`,
          );
        }
      }

      const order = typeof frontmatter.order === 'number' ? frontmatter.order : Number.POSITIVE_INFINITY;
      const route = `/reference/packages/${pkgFolder}/${toRoute(relPath)}`;

      if (relPath === 'index.md') {
        pkgTitle = frontmatter.title;
        pkgOrder = order;
      } else {
        pages.push({ text: frontmatter.title, link: route, order });
      }
      pageCount++;
    }

    pages.sort((a, b) => a.order - b.order || a.text.localeCompare(b.text));

    packageEntries.push({
      text: pkgTitle,
      link: `/reference/packages/${pkgFolder}/`,
      collapsed: true,
      order: pkgOrder,
      items: pages.map(({ order: _order, ...page }) => page),
    });
  }

  packageEntries.sort((a, b) => a.order - b.order || a.text.localeCompare(b.text));
  const sidebar = packageEntries.map(({ order: _order, ...entry }) => entry);

  writeFileSync(outSidebarFile, JSON.stringify(sidebar, null, 2) + '\n');

  return { packageCount: packageEntries.length, pageCount, outDocsDir, outSidebarFile };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const docsRoot = resolve(__dirname, '..');
  const packagesDir = resolve(docsRoot, '..', 'packages');

  try {
    const result = aggregatePackageDocs({ packagesDir, docsRoot });
    console.log(
      `[aggregate-package-docs] aggregated ${result.pageCount} page(s) across ${result.packageCount} package(s)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
