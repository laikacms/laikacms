/**
 * MDX body chunks.
 *
 * A markdown-serialized item deserializes to `{ ...frontmatter, body }` — the
 * frontmatter fields become the module's named exports as usual, and `body` is
 * prose. With `mdx: true` that prose is written out as a real `.mdx` file under
 * `.laika/vite-generated/bodies/` and the generated module re-exports its default as `Body`.
 *
 * This plugin never compiles MDX and never depends on it. It emits the chunk;
 * whatever the consumer put in their Vite config (`@mdx-js/rollup`, typically)
 * sees an ordinary `.mdx` path and takes it from there.
 *
 * The chunk has to be a real file on disk. `createFilter` from
 * `@rollup/pluginutils` — which extension-driven plugins like `@mdx-js/rollup`
 * use to pick their inputs — rejects any id containing a NUL byte, so a
 * `\0laika:…` virtual module could never reach them.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { writeAtomic } from './atomic-write.js';
import type { LaikaId } from './protocol.js';

/** The content field treated as prose (matches the markdown serializer's output). */
export const BODY_FIELD = 'body';

/** The name the compiled body is exported under. */
export const BODY_EXPORT = 'Body';

/** Where chunks live, relative to the Vite root. Already gitignored by the typegen. */
export const BODIES_DIR = '.laika/vite-generated/bodies';

/** The item's prose, or `null` when it has none. */
export function bodyOf(content: Record<string, unknown>): string | null {
  const body = content[BODY_FIELD];
  return typeof body === 'string' ? body : null;
}

/**
 * A repository key is not necessarily a filesystem path (a remote backend can
 * key on anything), so fold every path-unsafe run to `_`.
 */
function safeKey(key: string): string {
  return key
    .split('/')
    .map(segment => segment.replace(/[^\w.-]+/g, '_'))
    .filter(segment => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');
}

/** Absolute path of the chunk backing `id`. */
export function chunkPath(root: string, id: LaikaId): string {
  return path.join(root, BODIES_DIR, id.namespace, `${safeKey(id.key)}.mdx`);
}

/**
 * The specifier the generated module imports the chunk by. Root-relative, which
 * Vite resolves against the project root in both dev and build — a virtual
 * module has no directory to resolve a relative path from.
 */
export function chunkSpecifier(id: LaikaId): string {
  return `/${BODIES_DIR}/${id.namespace}/${safeKey(id.key)}.mdx`;
}

/** Write the chunk for `id`. Returns `true` when the file changed. */
export function writeChunk(root: string, id: LaikaId, body: string): Promise<boolean> {
  return writeAtomic(chunkPath(root, id), body.endsWith('\n') ? body : `${body}\n`);
}

/**
 * Remove every chunk that is not in `keep` — the paths `load` wrote during this
 * build — so a renamed or deleted key cannot leave a stale `.mdx` behind.
 *
 * Deliberately a sweep at the *end* of a build rather than a wipe at the start:
 * the directory is inside the Vite root, and clearing it out from under a dev
 * server running on the same project breaks its already-loaded chunk modules.
 *
 * @returns the paths removed.
 */
export async function pruneChunks(root: string, keep: ReadonlySet<string>): Promise<string[]> {
  const dir = path.join(root, BODIES_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(dir, { recursive: true });
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.mdx')) continue;
    const file = path.join(dir, entry);
    if (keep.has(file)) continue;
    await fs.rm(file, { force: true });
    removed.push(file);
  }
  return removed;
}
