import fs from 'node:fs';
import path from 'node:path';

const DEBOUNCE_MS = 100;

/**
 * Watch a single file by watching its parent directory and filtering by
 * basename. This survives editor atomic-replace saves (write-tmp + rename)
 * which break `fs.watch(file)` on macOS because the original inode is gone
 * after the rename.
 */
export function watchFile(
  filePath: string,
  onChange: () => void,
): () => void {
  const absPath = path.resolve(filePath);
  const dir = path.dirname(absPath);
  const base = path.basename(absPath);

  let pending: NodeJS.Timeout | undefined;
  const fire = (): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      onChange();
    }, DEBOUNCE_MS);
  };

  const watcher = fs.watch(dir, (_event, filename) => {
    if (filename === base) fire();
  });

  return () => {
    if (pending) clearTimeout(pending);
    watcher.close();
  };
}
