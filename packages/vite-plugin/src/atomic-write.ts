import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Write `content` to `filePath` atomically (temp file in the same directory,
 * then rename), skipping the write entirely when the file already matches.
 *
 * The skip is what keeps file watchers quiet: everything this plugin generates
 * lands under `.laika/vite-generated/`, inside the Vite root, so a redundant rewrite would
 * bounce straight back through HMR.
 *
 * @returns `true` when the file changed on disk.
 */
export async function writeAtomic(filePath: string, content: string): Promise<boolean> {
  try {
    const existing = await fs.readFile(filePath, 'utf8');
    if (existing === content) {
      return false;
    }
  } catch {
    // Missing file — fall through to write.
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, filePath);
  return true;
}
