#!/usr/bin/env node
// Zero-dependency doc locator for laikacms.
//
// Resolves the documentation that matches the *installed* version of laikacms
// in the current project, then lists the docs tree (or prints one doc).
//
// Usage:
//   node laika-docs.mjs index [--json]      List the docs tree for the installed version.
//   node laika-docs.mjs get <docs/path.md>  Print one doc's raw content.
//   node laika-docs.mjs resolve [--json]    Just show version + resolved git ref.
//
// Anchor ladder (most precise first):
//   1. `gitHead` in the installed package.json  -> exact commit
//   2. git tag `laikacms@<version>`             -> exact release (if pushed to GitHub)
//   3. repo default branch                       -> latest, may be newer than installed
//
// Env: GITHUB_TOKEN (optional) raises the GitHub API rate limit from 60 to 5000/hr.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const OWNER = 'laikacms';
const REPO = 'laikacms';
const PKG = 'laikacms';

const args = process.argv.slice(2);
const cmd = args[0] ?? 'index';
const asJson = args.includes('--json');

function ghHeaders() {
  const h = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'laika-docs-skill' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function ghJson(url) {
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) return { __error: `${res.status} ${res.statusText}`, __url: url };
  return res.json();
}

// --- 1. Detect the installed laikacms version -------------------------------
function readInstalledPkg() {
  const cwd = process.cwd();
  // Preferred: resolve exactly what the project would import.
  try {
    const require = createRequire(join(cwd, 'noop.js'));
    const p = require.resolve(`${PKG}/package.json`);
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    // Not resolvable from cwd — fall through to the direct lookup.
  }
  // Fallback: direct node_modules lookup.
  try {
    return JSON.parse(readFileSync(join(cwd, 'node_modules', PKG, 'package.json'), 'utf8'));
  } catch {
    // laikacms isn't installed in this project.
    return null;
  }
}

function declaredRange() {
  try {
    const p = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    return (p.dependencies?.[PKG]) ?? (p.devDependencies?.[PKG]) ?? null;
  } catch {
    return null;
  }
}

// --- 2. Resolve a git ref for that version ----------------------------------
async function resolveRef(pkg, version) {
  // 2a. gitHead baked into the published package (exact commit).
  if (pkg?.gitHead && /^[0-9a-f]{40}$/.test(pkg.gitHead)) {
    return { ref: pkg.gitHead, kind: 'commit', pinned: true, via: 'package.json gitHead' };
  }
  // 2b. Release tag `laikacms@<version>` (changesets convention).
  if (version) {
    const tag = `${PKG}@${version}`;
    const r = await ghJson(
      `https://api.github.com/repos/${OWNER}/${REPO}/git/ref/tags/${encodeURIComponent(tag)}`,
    );
    if (!r.__error && r.object?.sha) {
      return { ref: tag, kind: 'tag', pinned: true, via: `tag ${tag}` };
    }
  }
  // 2c. Fallback: the repo's default branch (latest docs).
  const repo = await ghJson(`https://api.github.com/repos/${OWNER}/${REPO}`);
  const branch = repo.__error ? 'develop' : (repo.default_branch ?? 'develop');
  return {
    ref: branch,
    kind: 'branch',
    pinned: false,
    via: `default branch ${branch}`,
    warning: version
      ? `No pinned ref for v${version} (tag not pushed / no gitHead). Showing latest docs from "${branch}" — they may be newer than your installed version.`
      : `laikacms not found in this project. Showing latest docs from "${branch}".`,
  };
}

// --- 3. List the docs tree at a ref -----------------------------------------
async function listDocs(ref) {
  const tree = await ghJson(
    `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  if (!tree.__error && Array.isArray(tree.tree)) {
    const docs = tree.tree
      .filter(t => t.type === 'blob' && t.path.startsWith('docs/') && t.path.endsWith('.md'))
      .map(t => t.path);
    return { docs, truncated: !!tree.truncated, source: 'github-api' };
  }
  // Fallback to the jsDelivr CDN (no rate limit) — needs the ref synced.
  const cdn = await fetch(
    `https://data.jsdelivr.com/v1/packages/gh/${OWNER}/${REPO}@${encodeURIComponent(ref)}?structure=flat`,
  ).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (cdn?.files) {
    const docs = cdn.files
      .map(f => f.name.replace(/^\//, ''))
      .filter(n => n.startsWith('docs/') && n.endsWith('.md'));
    return { docs, truncated: false, source: 'jsdelivr', apiError: tree.__error };
  }
  return { docs: [], truncated: false, source: 'none', apiError: tree.__error };
}

async function fetchDoc(ref, path) {
  const raw = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${encodeURIComponent(ref)}/${path}`;
  let res = await fetch(raw).catch(() => null);
  if (res?.ok) return res.text();
  const cdn = `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${encodeURIComponent(ref)}/${path}`;
  res = await fetch(cdn).catch(() => null);
  if (res?.ok) return res.text();
  return null;
}

// Orientation docs to always surface first, if present.
const ORIENTATION = [
  'docs/index.md',
  'docs/guides/index.md',
  'docs/guides/getting-started.md',
  'docs/concepts/index.md',
  'docs/reference/index.md',
  'docs/reference/packages.md',
];

function groupDocs(docs) {
  const groups = {};
  for (const d of docs) {
    const rel = d.slice('docs/'.length);
    const top = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '(root)';
    (groups[top] ??= []).push(d);
  }
  return groups;
}

// --- Commands ---------------------------------------------------------------
async function main() {
  const pkg = readInstalledPkg();
  const version = pkg?.version ?? null;
  const resolved = await resolveRef(pkg, version);

  if (cmd === 'get') {
    const path = args[1];
    if (!path) {
      console.error('Usage: laika-docs.mjs get <docs/path.md>');
      process.exit(1);
    }
    const content = await fetchDoc(resolved.ref, path.replace(/^\/+/, ''));
    if (content == null) {
      console.error(`Could not fetch ${path} at ${resolved.ref}`);
      process.exit(1);
    }
    process.stdout.write(content);
    return;
  }

  const meta = {
    package: PKG,
    installedVersion: version,
    declaredRange: declaredRange(),
    ref: resolved.ref,
    refKind: resolved.kind,
    versionPinned: resolved.pinned,
    resolvedVia: resolved.via,
    warning: resolved.warning ?? null,
    browseUrl: `https://github.com/${OWNER}/${REPO}/tree/${resolved.ref}/docs`,
    rawUrlTemplate: `https://raw.githubusercontent.com/${OWNER}/${REPO}/${resolved.ref}/<path>`,
  };

  if (cmd === 'resolve') {
    console.log(asJson ? JSON.stringify(meta, null, 2) : renderMeta(meta));
    return;
  }

  // cmd === 'index'
  const { docs, truncated, source, apiError } = await listDocs(resolved.ref);
  const orientation = ORIENTATION.filter(d => docs.includes(d));
  const groups = groupDocs(docs);

  if (asJson) {
    console.log(JSON.stringify({ ...meta, listedVia: source, orientation, groups, truncated }, null, 2));
    return;
  }

  const lines = [renderMeta(meta), ''];
  if (apiError && source !== 'github-api') {
    lines.push(`(GitHub API unavailable: ${apiError} — listed via ${source})`, '');
  }
  if (orientation.length) {
    lines.push('Start here:');
    for (const d of orientation) lines.push(`  • ${d}`);
    lines.push('');
  }
  lines.push(`Docs tree (${docs.length} files):`);
  for (const [group, items] of Object.entries(groups).sort()) {
    lines.push(`  ${group}/`);
    for (const it of items) lines.push(`    ${it.slice('docs/'.length)}`);
  }
  lines.push('');
  lines.push(`Read one:  node laika-docs.mjs get <path>`);
  console.log(lines.join('\n'));
}

function renderMeta(m) {
  const tag = m.versionPinned ? `pinned @ ${m.ref}` : `NOT pinned (${m.ref})`;
  const head = m.installedVersion
    ? `laikacms v${m.installedVersion} — docs ${tag}`
    : `laikacms not installed — docs ${tag}`;
  const out = [head, `  resolved via: ${m.resolvedVia}`, `  browse: ${m.browseUrl}`];
  if (m.warning) out.push(`  ⚠ ${m.warning}`);
  return out.join('\n');
}

main().catch(e => {
  console.error(e?.stack ?? String(e));
  process.exit(1);
});
