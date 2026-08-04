import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeAtomic } from '../atomic-write.js';

/**
 * Filesystem sink for generated types. All writes go through
 * {@link writeAtomic}: temp-file-then-rename, and skipped entirely when the
 * existing file already matches (so file watchers / HMR don't churn).
 *
 * Layout under `<viteRoot>`:
 *   .laika/types.d.ts                 aggregated ambient module declarations
 *   .laika/collections/<name>.ts      per-collection union aliases
 *   .laika/.gitignore                 `*` (never commit generated output)
 *   laika-env.d.ts                    committed one-line /// reference
 *   .gitignore                        `.laika/` appended idempotently
 */
export class TypegenWriter {
  private readonly root: string;

  constructor(viteRoot: string) {
    this.root = viteRoot;
  }

  get laikaDir(): string {
    return path.join(this.root, '.laika');
  }

  get typesFile(): string {
    return path.join(this.laikaDir, 'types.d.ts');
  }

  get collectionsDir(): string {
    return path.join(this.laikaDir, 'collections');
  }

  get envFile(): string {
    return path.join(this.root, 'laika-env.d.ts');
  }

  collectionFile(name: string): string {
    return path.join(this.collectionsDir, `${name}.ts`);
  }

  async writeTypes(content: string): Promise<boolean> {
    await fs.mkdir(this.laikaDir, { recursive: true });
    return writeAtomic(this.typesFile, content);
  }

  async writeCollection(name: string, content: string): Promise<boolean> {
    await fs.mkdir(this.collectionsDir, { recursive: true });
    return writeAtomic(this.collectionFile(name), content);
  }

  /**
   * Removes any `.laika/collections/*.ts` whose base name is not in `keep`.
   * Returns the names that were removed.
   */
  async pruneCollections(keep: ReadonlySet<string>): Promise<string[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.collectionsDir);
    } catch {
      return [];
    }
    const removed: string[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.ts')) {
        continue;
      }
      const name = entry.slice(0, -'.ts'.length);
      if (!keep.has(name)) {
        await fs.rm(path.join(this.collectionsDir, entry), { force: true });
        removed.push(name);
      }
    }
    return removed;
  }

  /**
   * Creates the committed `laika-env.d.ts` reference file only when it does not
   * already exist. Never clobbers a user-modified file. Returns `true` when it
   * was created.
   */
  async ensureEnvReference(): Promise<boolean> {
    try {
      await fs.access(this.envFile);
      return false;
    } catch {
      await fs.writeFile(this.envFile, '/// <reference path="./.laika/types.d.ts" />\n', 'utf8');
      return true;
    }
  }

  /** Writes `.laika/.gitignore` containing `*` (idempotent). */
  async ensureLaikaGitignore(): Promise<boolean> {
    await fs.mkdir(this.laikaDir, { recursive: true });
    return writeAtomic(path.join(this.laikaDir, '.gitignore'), '*\n');
  }

  /**
   * Idempotently appends `.laika/` to `<viteRoot>/.gitignore`, creating the
   * file if absent. Returns `true` when the file was changed.
   */
  async ensureRootGitignore(): Promise<boolean> {
    const gitignore = path.join(this.root, '.gitignore');
    let existing = '';
    try {
      existing = await fs.readFile(gitignore, 'utf8');
    } catch {
      // absent
    }
    const lines = existing.split(/\r?\n/).map(l => l.trim());
    if (lines.includes('.laika/') || lines.includes('.laika')) {
      return false;
    }
    const needsNewline = existing.length > 0 && !existing.endsWith('\n');
    const next = `${existing}${needsNewline ? '\n' : ''}.laika/${os.EOL === '\r\n' ? '\r\n' : '\n'}`;
    await fs.writeFile(gitignore, next, 'utf8');
    return true;
  }
}
