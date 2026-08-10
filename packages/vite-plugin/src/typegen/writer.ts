import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeAtomic } from '../atomic-write.js';

/**
 * Filesystem sink for generated types. All writes go through
 * {@link writeAtomic}: temp-file-then-rename, and skipped entirely when the
 * existing file already matches (so file watchers / HMR don't churn).
 *
 * Everything this class writes lives under `.laika/vite-generated/`. The rest of
 * `.laika/` is durable state owned by the catalog (`.laika/catalog`,
 * `.laika/schemas/`, `.laika/revisions/`) and must stay committed, so only the
 * `vite-generated/` subtree is ever ignored.
 *
 * Layout under `<viteRoot>`:
 *   .laika/vite-generated/types.d.ts             aggregated ambient module declarations
 *   .laika/vite-generated/collections/<name>.ts  per-collection union aliases
 *   .laika/.gitignore                            `vite-generated/`
 *   laika-env.d.ts                               committed one-line /// reference
 *   .gitignore                                   `.laika/vite-generated/` appended idempotently
 */
export class TypegenWriter {
  private readonly root: string;

  constructor(viteRoot: string) {
    this.root = viteRoot;
  }

  get laikaDir(): string {
    return path.join(this.root, '.laika');
  }

  get generatedDir(): string {
    return path.join(this.laikaDir, 'vite-generated');
  }

  get typesFile(): string {
    return path.join(this.generatedDir, 'types.d.ts');
  }

  get collectionsDir(): string {
    return path.join(this.generatedDir, 'collections');
  }

  get envFile(): string {
    return path.join(this.root, 'laika-env.d.ts');
  }

  collectionFile(name: string): string {
    return path.join(this.collectionsDir, `${name}.ts`);
  }

  async writeTypes(content: string): Promise<boolean> {
    await fs.mkdir(this.generatedDir, { recursive: true });
    return writeAtomic(this.typesFile, content);
  }

  async writeCollection(name: string, content: string): Promise<boolean> {
    await fs.mkdir(this.collectionsDir, { recursive: true });
    return writeAtomic(this.collectionFile(name), content);
  }

  /**
   * Removes any `.laika/vite-generated/collections/*.ts` whose base name is not in `keep`.
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
      await fs.writeFile(
        this.envFile,
        '/// <reference path="./.laika/vite-generated/types.d.ts" />\n',
        'utf8',
      );
      return true;
    }
  }

  /**
   * Writes `.laika/.gitignore` containing `vite-generated/` (idempotent). Scoped
   * to the generated subtree so the catalog alongside it stays committed.
   */
  async ensureLaikaGitignore(): Promise<boolean> {
    await fs.mkdir(this.laikaDir, { recursive: true });
    return writeAtomic(path.join(this.laikaDir, '.gitignore'), 'vite-generated/\n');
  }

  /**
   * Idempotently appends `.laika/vite-generated/` to `<viteRoot>/.gitignore`,
   * creating the file if absent. Returns `true` when the file was changed.
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
    if (lines.includes('.laika/vite-generated/') || lines.includes('.laika/vite-generated')) {
      return false;
    }
    const needsNewline = existing.length > 0 && !existing.endsWith('\n');
    const next = `${existing}${needsNewline ? '\n' : ''}.laika/vite-generated/${os.EOL === '\r\n' ? '\r\n' : '\n'}`;
    await fs.writeFile(gitignore, next, 'utf8');
    return true;
  }
}
