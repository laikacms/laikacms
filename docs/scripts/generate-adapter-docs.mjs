#!/usr/bin/env node
/**
 * Prebuild step: compiles the root `adapters.yaml` into the docs' Adapters section.
 *
 * `adapters.yaml` lists every backend Laika ships an adapter for — a unique key, a display name, the
 * path to its SVG, and the folder of each repository it provides (storage / documents / assets).
 * Each of those folders carries a README.md, which is the page content: the docs never restate
 * what the adapter's own README says.
 *
 * Output is fully generated and gitignored — never hand-edit it:
 *   - docs/adapters/<key>.md               one page per adapter, built from its READMEs
 *   - docs/public/adapters/<key>.svg       the adapter's icon (and <key>-dark.svg for dark mode)
 *   - docs/.vitepress/adapters/list.md     the adapter list, included by docs/adapters/index.md
 *   - docs/.vitepress/adapters/logos.md    a row of linked logos, included by docs/index.md
 *   - docs/.vitepress/adapters/sidebar.json  sidebar entries, read by docs/.vitepress/config.ts
 *
 * Idempotent: generated files are wiped and rebuilt on every run.
 */
import { load } from 'js-yaml';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository types, in the order they are shown. */
export const REPOSITORY_TYPES = [
  { field: 'storage', title: 'Storage' },
  { field: 'documents', title: 'Documents' },
  { field: 'assets', title: 'Assets' },
];

const SOURCE_URL = 'https://github.com/laikacms/laikacms/blob/develop';
const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LINK_RE = /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g;

/**
 * Parse and validate `adapters.yaml`. Every path must exist, so a moved README or icon fails the
 * docs build instead of silently dropping an adapter.
 */
export function readAdapters(rootDir, file = join(rootDir, 'adapters.yaml')) {
  const adapters = load(readFileSync(file, 'utf8'));
  if (!Array.isArray(adapters)) throw new Error(`${file}: expected a list of adapters`);

  const seen = new Set();
  for (const adapter of adapters) {
    const where = `${file}: adapter "${adapter?.key}"`;
    if (typeof adapter?.key !== 'string' || !KEY_RE.test(adapter.key)) {
      throw new Error(`${where}: "key" must be kebab-case`);
    }
    if (seen.has(adapter.key)) throw new Error(`${where}: duplicate key`);
    seen.add(adapter.key);
    if (typeof adapter.name !== 'string' || !adapter.name) throw new Error(`${where}: "name" is required`);
    for (const field of ['icon', 'iconDark']) {
      if (field === 'iconDark' && adapter.iconDark === undefined) continue;
      if (typeof adapter[field] !== 'string' || !adapter[field].endsWith('.svg')) {
        throw new Error(`${where}: "${field}" must be a path to an .svg file`);
      }
      if (!existsSync(join(rootDir, adapter[field]))) {
        throw new Error(`${where}: ${field} ${adapter[field]} does not exist`);
      }
    }

    const provided = REPOSITORY_TYPES.filter(({ field }) => adapter[field] !== undefined);
    if (provided.length === 0) throw new Error(`${where}: provides no storage, documents or assets repository`);
    for (const { field } of provided) {
      const readme = join(rootDir, adapter[field], 'README.md');
      if (!existsSync(readme)) throw new Error(`${where}: ${field} folder ${adapter[field]} has no README.md`);
    }
  }
  return adapters;
}

/**
 * Turn a README into a page section: drop its H1 (the section heading replaces it), nest its
 * headings one level deeper, and rewrite relative links — into docs/ they become site links,
 * anything else points at the file on GitHub.
 */
export function readmeToSection(markdown, readmeDir) {
  let inFence = false;
  const lines = [];
  let droppedTitle = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && !droppedTitle && /^# /.test(line)) {
      droppedTitle = true;
      continue;
    }
    if (!inFence && /^#{2,5} /.test(line)) {
      lines.push(`#${line}`);
      continue;
    }
    lines.push(
      inFence ? line : line.replace(LINK_RE, (_, open, target, close) => open + rewriteLink(target, readmeDir) + close),
    );
  }
  return lines.join('\n').trim();
}

function rewriteLink(target, readmeDir) {
  if (target.startsWith('#') || target.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  const [path, hash] = target.split('#');
  const resolved = posix.normalize(posix.join(readmeDir, path));
  const anchor = hash ? `#${hash}` : '';
  if (resolved.startsWith('docs/') && resolved.endsWith('.md')) {
    return `/${resolved.slice('docs/'.length).replace(/(index)?\.md$/, '')}${anchor}`;
  }
  return `${SOURCE_URL}/${resolved}${anchor}`;
}

/**
 * The adapter's logo as markdown: the light and the dark SVG side by side, of which custom.css
 * shows the one matching the current theme.
 */
export function iconMarkdown(adapter, title = '') {
  const t = title ? ` "${title}"` : '';
  return `![${title}](/adapters/${adapter.key}.svg${t}){.adapter-icon .adapter-icon-light}`
    + `![${title}](/adapters/${adapter.key}-dark.svg${t}){.adapter-icon .adapter-icon-dark}`;
}

function adapterPage(rootDir, adapter) {
  const sections = REPOSITORY_TYPES.filter(({ field }) => adapter[field] !== undefined).map(({ field, title }) => {
    const readme = readFileSync(join(rootDir, adapter[field], 'README.md'), 'utf8');
    // `v-pre` keeps README text like `{{ … }}` from being compiled as Vue template syntax.
    return [
      `## ${title} {#${field}}`,
      `Source: [\`${adapter[field]}\`](${SOURCE_URL}/${adapter[field]})`,
      '<div v-pre>',
      readmeToSection(readme, adapter[field]),
      '</div>',
    ].join('\n\n');
  });

  return [
    '---',
    `title: ${JSON.stringify(adapter.name)}`,
    '---',
    '',
    '<!-- Generated from adapters.yaml and the adapter READMEs by docs/scripts/generate-adapter-docs.mjs. Do not edit. -->',
    '',
    `# ${iconMarkdown(adapter)} ${adapter.name}`,
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');
}

export function adapterList(adapters) {
  const header = `|  | Adapter | ${REPOSITORY_TYPES.map(t => t.title).join(' | ')} |`;
  const divider = `| - | - | ${REPOSITORY_TYPES.map(() => ':-:').join(' | ')} |`;
  const rows = adapters.map(adapter => {
    const cells = REPOSITORY_TYPES.map(({ field, title }) =>
      adapter[field] === undefined ? '' : `[${title}](./${adapter.key}#${field})`
    );
    return `| ${iconMarkdown(adapter)} | [${adapter.name}](./${adapter.key}) | ${cells.join(' | ')} |`;
  });
  return [header, divider, ...rows, ''].join('\n');
}

/** A row of linked adapter logos, for pages that point at the Adapters section. */
export function adapterLogos(adapters) {
  const logos = adapters.map(a => `[${iconMarkdown(a, a.name)}](/adapters/${a.key})`);
  return `${logos.join(' ')}\n{.adapter-logos}\n`;
}

export function generateAdapterDocs({ rootDir, docsRoot }) {
  const adapters = readAdapters(rootDir);
  const pagesDir = join(docsRoot, 'adapters');
  const iconsDir = join(docsRoot, 'public', 'adapters');
  const generatedDir = join(docsRoot, '.vitepress', 'adapters');

  // Wipe the previous run. Pages are only the files this script owns; index.md is hand-written.
  for (const name of existsSync(pagesDir) ? readdirSync(pagesDir).filter(n => n.endsWith('.md')) : []) {
    if (readFileSync(join(pagesDir, name), 'utf8').includes('generate-adapter-docs.mjs. Do not edit.')) {
      rmSync(join(pagesDir, name));
    }
  }
  rmSync(iconsDir, { recursive: true, force: true });
  rmSync(generatedDir, { recursive: true, force: true });
  mkdirSync(iconsDir, { recursive: true });
  mkdirSync(generatedDir, { recursive: true });

  for (const adapter of adapters) {
    const page = join(pagesDir, `${adapter.key}.md`);
    if (existsSync(page)) {
      throw new Error(`docs/adapters/${adapter.key}.md is hand-written; it collides with adapter "${adapter.key}"`);
    }
    writeFileSync(page, adapterPage(rootDir, adapter));
    copyFileSync(join(rootDir, adapter.icon), join(iconsDir, `${adapter.key}.svg`));
    copyFileSync(join(rootDir, adapter.iconDark ?? adapter.icon), join(iconsDir, `${adapter.key}-dark.svg`));
  }
  writeFileSync(join(generatedDir, 'list.md'), adapterList(adapters));
  writeFileSync(join(generatedDir, 'logos.md'), adapterLogos(adapters));
  writeFileSync(
    join(generatedDir, 'sidebar.json'),
    JSON.stringify(adapters.map(a => ({ key: a.key, text: a.name, link: `/adapters/${a.key}` })), null, 2) + '\n',
  );
  return { adapterCount: adapters.length };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const { adapterCount } = generateAdapterDocs({ rootDir: resolve(docsRoot, '..'), docsRoot });
    console.log(`[generate-adapter-docs] generated ${adapterCount} adapter page(s)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
