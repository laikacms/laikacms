import * as Result from 'effect/Result';
import * as fs from 'fs/promises';
import { NotFoundError } from 'laikacms/core';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemDataSource } from './filesystem-datasource.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-fs-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('FileSystemDataSource.createOrUpdate', () => {
  it('writes a file with the given extension and returns the extension-less path', async () => {
    const ds = new FileSystemDataSource(['md', 'json'], 'md');
    const result = await ds.createOrUpdate(tmpDir, 'docs/hello', '# Hi', 'md');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.path).toBe('docs/hello');
    }

    const written = await fs.readFile(path.join(tmpDir, 'docs/hello.md'), 'utf8');
    expect(written).toBe('# Hi');
  });

  it('creates intermediate directories when they do not exist', async () => {
    const ds = new FileSystemDataSource(['txt'], 'txt');
    await ds.createOrUpdate(tmpDir, 'deeply/nested/path/file', 'data', 'txt');

    const written = await fs.readFile(path.join(tmpDir, 'deeply/nested/path/file.txt'), 'utf8');
    expect(written).toBe('data');
  });

  it('overwrites an existing file', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    await ds.createOrUpdate(tmpDir, 'note', 'first', 'md');
    await ds.createOrUpdate(tmpDir, 'note', 'second', 'md');

    expect(await fs.readFile(path.join(tmpDir, 'note.md'), 'utf8')).toBe('second');
  });

  it('strips a user-provided extension before re-applying the configured one', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    // The interface should ignore the extension in the path.
    await ds.createOrUpdate(tmpDir, 'note.md', 'body', 'md');

    expect(await fs.readFile(path.join(tmpDir, 'note.md'), 'utf8')).toBe('body');
    // Should NOT have created note.md.md
    await expect(fs.access(path.join(tmpDir, 'note.md.md'))).rejects.toThrow();
  });
});

describe('FileSystemDataSource.getFileContents', () => {
  it('reads a file written via createOrUpdate', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    await ds.createOrUpdate(tmpDir, 'doc', 'hello', 'md');

    const result = await ds.getFileContents(tmpDir, 'doc');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.content).toBe('hello');
      expect(result.success.path).toBe('doc');
      expect(result.success.extension).toBe('md');
    }
  });

  it('resolves a missing extension by trying the available list', async () => {
    const ds = new FileSystemDataSource(['md', 'json'], 'md');
    await fs.writeFile(path.join(tmpDir, 'data.json'), '{"k":1}');

    const result = await ds.getFileContents(tmpDir, 'data');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.extension).toBe('json');
    }
  });

  it('returns NotFoundError for a missing file', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    const result = await ds.getFileContents(tmpDir, 'missing');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('not_found');
    }
  });
});

describe('FileSystemDataSource.findExistingFileExtension', () => {
  it('returns the matching extension when the file exists', async () => {
    const ds = new FileSystemDataSource(['md', 'json'], 'md');
    await fs.writeFile(path.join(tmpDir, 'item.json'), '{}');

    expect(await ds.findExistingFileExtension(tmpDir, 'item')).toBe('json');
  });

  it('returns null when no variant exists', async () => {
    const ds = new FileSystemDataSource(['md', 'json'], 'md');
    expect(await ds.findExistingFileExtension(tmpDir, 'nope')).toBeNull();
  });

  it('respects the order in availableExtensions when multiple files exist', async () => {
    const ds = new FileSystemDataSource(['md', 'json'], 'md');
    await fs.writeFile(path.join(tmpDir, 'both.md'), 'md');
    await fs.writeFile(path.join(tmpDir, 'both.json'), '{}');

    // First match wins per the loop in resolvePathWithExtension/findExistingFileExtension.
    expect(await ds.findExistingFileExtension(tmpDir, 'both')).toBe('md');
  });
});

describe('FileSystemDataSource.getFileMeta', () => {
  it('returns size and timestamps for an existing file', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    await ds.createOrUpdate(tmpDir, 'doc', 'twelve bytes', 'md');

    const result = await ds.getFileMeta(tmpDir, 'doc');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.size).toBe(12);
      expect(result.success.extension).toBe('md');
      expect(result.success.path).toBe('doc');
      expect(result.success.createdAt).toBeInstanceOf(Date);
      expect(result.success.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('returns NotFoundError for a missing file', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    const result = await ds.getFileMeta(tmpDir, 'nope');
    expect(Result.isFailure(result)).toBe(true);
  });

  it('createdAt is stable after a write (LCMS-285: should not equal updatedAt after overwrite)', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    await ds.createOrUpdate(tmpDir, 'stable', 'v1', 'md');

    const filePath = path.join(tmpDir, 'stable.md');

    // Wait 5ms then advance mtime/atime to simulate a later write without relying on wall-clock.
    // birthtimeMs stays fixed because utimes() only changes atime/mtime.
    await new Promise(r => setTimeout(r, 5));
    const futureTime = new Date(Date.now() + 10_000);
    await fs.utimes(filePath, futureTime, futureTime);

    const result = await ds.getFileMeta(tmpDir, 'stable');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const { createdAt, updatedAt } = result.success;
      // On filesystems with real birth time support createdAt must predate updatedAt.
      // On filesystems where birthtimeMs === 0 we fall back to ctime; skip the strict
      // ordering check because ctime also advances on utimes() on those systems.
      const rawStat = await fs.stat(filePath);
      if (rawStat.birthtimeMs > 0) {
        expect(createdAt.getTime()).toBeLessThan(updatedAt.getTime());
      } else {
        // Ensure the field is at least a valid Date.
        expect(createdAt).toBeInstanceOf(Date);
      }
    }
  });
});

describe('FileSystemDataSource.getDirMeta', () => {
  it('returns timestamps for an existing directory', async () => {
    const ds = new FileSystemDataSource([], '');
    await fs.mkdir(path.join(tmpDir, 'sub'));

    const result = await ds.getDirMeta(tmpDir, 'sub');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.createdAt).toBeInstanceOf(Date);
      expect(result.success.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('returns NotFoundError for a missing directory', async () => {
    const ds = new FileSystemDataSource([], '');
    const result = await ds.getDirMeta(tmpDir, 'missing');
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe('FileSystemDataSource.getDirectoryContents', () => {
  it('lists files and subdirectories with paths relative to basePath', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    await fs.mkdir(path.join(tmpDir, 'sub'));
    await fs.writeFile(path.join(tmpDir, 'a.md'), '');
    await fs.writeFile(path.join(tmpDir, 'b.md'), '');

    const result = await ds.getDirectoryContents(tmpDir, '.');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const types = result.success.map(e => `${e.type}:${e.path}`).sort();
      expect(types).toEqual(['dir:sub', 'file:a.md', 'file:b.md']);
    }
  });

  it('returns NotFoundError for a missing directory', async () => {
    const ds = new FileSystemDataSource([], '');
    const result = await ds.getDirectoryContents(tmpDir, 'does-not-exist');
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe('FileSystemDataSource.isDir', () => {
  it('returns true for a directory', async () => {
    const ds = new FileSystemDataSource([], '');
    await fs.mkdir(path.join(tmpDir, 'sub'));
    expect(await ds.isDir(tmpDir, 'sub')).toBe(true);
  });

  it('returns false for a file', async () => {
    const ds = new FileSystemDataSource([], '');
    await fs.writeFile(path.join(tmpDir, 'f.txt'), '');
    expect(await ds.isDir(tmpDir, 'f.txt')).toBe(false);
  });

  it('throws NotFoundError for a missing path', async () => {
    const ds = new FileSystemDataSource([], '');
    await expect(ds.isDir(tmpDir, 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('FileSystemDataSource.getFileSystemEntry', () => {
  it('returns a directory entry with its children when type=dir', async () => {
    const ds = new FileSystemDataSource([], '');
    await fs.mkdir(path.join(tmpDir, 'sub'));
    await fs.writeFile(path.join(tmpDir, 'sub/inner.txt'), 'x');

    const result = await ds.getFileSystemEntry(tmpDir, 'sub', 'dir');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result) && result.success.type === 'dir') {
      expect(result.success.path).toBe('sub');
      expect(result.success.content.map(e => `${e.type}:${e.path}`)).toEqual(
        ['file:sub/inner.txt'],
      );
    }
  });

  it('returns a file entry with its content when type=file', async () => {
    const ds = new FileSystemDataSource([], '');
    await fs.writeFile(path.join(tmpDir, 'f.txt'), 'hello');

    const result = await ds.getFileSystemEntry(tmpDir, 'f.txt', 'file');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result) && result.success.type === 'file') {
      expect(result.success.content).toBe('hello');
    }
  });

  it('returns DirInsteadOfFile when expecting file but finding a directory', async () => {
    const ds = new FileSystemDataSource([], '');
    await fs.mkdir(path.join(tmpDir, 'sub'));

    const result = await ds.getFileSystemEntry(tmpDir, 'sub', 'file');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('dir_instead_of_file');
    }
  });

  it('returns FileInsteadOfDir when expecting dir but finding a file', async () => {
    const ds = new FileSystemDataSource([], '');
    await fs.writeFile(path.join(tmpDir, 'f.txt'), '');

    const result = await ds.getFileSystemEntry(tmpDir, 'f.txt', 'dir');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('file_instead_of_dir');
    }
  });

  it('accepts either when type=both', async () => {
    const ds = new FileSystemDataSource([], '');
    await fs.writeFile(path.join(tmpDir, 'f.txt'), 'data');
    await fs.mkdir(path.join(tmpDir, 'sub'));

    const fileResult = await ds.getFileSystemEntry(tmpDir, 'f.txt', 'both');
    const dirResult = await ds.getFileSystemEntry(tmpDir, 'sub', 'both');
    expect(Result.isSuccess(fileResult)).toBe(true);
    expect(Result.isSuccess(dirResult)).toBe(true);
  });

  it('returns NotFoundError when the path does not exist', async () => {
    const ds = new FileSystemDataSource([], '');
    const result = await ds.getFileSystemEntry(tmpDir, 'missing', 'both');
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe('FileSystemDataSource dot-prefix key handling (LCMS-132)', () => {
  it('createOrUpdate preserves .contentbase/ prefix — path returned is unchanged for extension-less key', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    const result = await ds.createOrUpdate(tmpDir, '.contentbase/published/my-slug', 'content', 'md');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.path).toBe('.contentbase/published/my-slug');
    }
    // File must exist at the correct on-disk path
    const written = await fs.readFile(path.join(tmpDir, '.contentbase/published/my-slug.md'), 'utf8');
    expect(written).toBe('content');
  });

  it('getFileContents returns correct path for .contentbase/ key with .md extension', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    await ds.createOrUpdate(tmpDir, '.contentbase/published/my-slug', 'body', 'md');

    const result = await ds.getFileContents(tmpDir, '.contentbase/published/my-slug');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.path).toBe('.contentbase/published/my-slug');
      expect(result.success.extension).toBe('md');
    }
  });

  it('stripExtension via createOrUpdate does not truncate key with no extension under dot-dir', async () => {
    // Passing a key that has NO extension — the leading dot must not trigger slicing
    const ds = new FileSystemDataSource(['md'], 'md');
    const result = await ds.createOrUpdate(tmpDir, '.contentbase/published/my-slug', 'data', 'md');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      // Must NOT be '' or '.contentbase/published'
      expect(result.success.path).toBe('.contentbase/published/my-slug');
    }
  });

  it('stripExtension still removes a real extension under a dot-prefix dir', async () => {
    // Key passed WITH .md extension — should still strip it correctly
    const ds = new FileSystemDataSource(['md'], 'md');
    const result = await ds.createOrUpdate(tmpDir, '.contentbase/published/my-slug.md', 'data', 'md');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.path).toBe('.contentbase/published/my-slug');
    }
    // Should not create .contentbase/published/my-slug.md.md
    await expect(fs.access(path.join(tmpDir, '.contentbase/published/my-slug.md.md'))).rejects.toThrow();
  });

  it('notes/hello.md strips to notes/hello via createOrUpdate round-trip', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    const result = await ds.createOrUpdate(tmpDir, 'notes/hello.md', 'hi', 'md');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.path).toBe('notes/hello');
    }
  });
});

describe('FileSystemDataSource dotted-key round-trip (LCMS-350)', () => {
  it('createOrUpdate stores v1.0.0 as v1.0.0.json (not v1.0.json)', async () => {
    const ds = new FileSystemDataSource(['json', 'md'], 'json');
    const result = await ds.createOrUpdate(tmpDir, 'revisions/v1.0.0', '{"v":1}', 'json');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.path).toBe('revisions/v1.0.0');
    }
    // Correct file must exist
    const content = await fs.readFile(path.join(tmpDir, 'revisions/v1.0.0.json'), 'utf8');
    expect(content).toBe('{"v":1}');
    // Wrong path must NOT exist
    await expect(fs.access(path.join(tmpDir, 'revisions/v1.0.json'))).rejects.toThrow();
  });

  it('getFileContents round-trips v1.0.0 key written by createOrUpdate', async () => {
    const ds = new FileSystemDataSource(['json'], 'json');
    await ds.createOrUpdate(tmpDir, 'rev/v1.0.0', '{"ok":true}', 'json');

    const result = await ds.getFileContents(tmpDir, 'rev/v1.0.0');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.content).toBe('{"ok":true}');
      expect(result.success.path).toBe('rev/v1.0.0');
      expect(result.success.extension).toBe('json');
    }
  });

  it('getDirectoryContents exposes v1.0.0.json as file path (strip happens in repository layer)', async () => {
    const ds = new FileSystemDataSource(['json'], 'json');
    await ds.createOrUpdate(tmpDir, 'rev/v1.0.0', '{}', 'json');
    await ds.createOrUpdate(tmpDir, 'rev/v2.3.1', '{}', 'json');

    const result = await ds.getDirectoryContents(tmpDir, 'rev');
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      const names = result.success.map(e => e.path).sort();
      expect(names).toContain('rev/v1.0.0.json');
      expect(names).toContain('rev/v2.3.1.json');
    }
  });

  it('keys with no dots are unaffected', async () => {
    const ds = new FileSystemDataSource(['json'], 'json');
    const result = await ds.createOrUpdate(tmpDir, 'plain-key', '{}', 'json');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.path).toBe('plain-key');
    }
    await fs.access(path.join(tmpDir, 'plain-key.json'));
  });

  it('a key that IS a known extension suffix (foo.json) strips correctly', async () => {
    const ds = new FileSystemDataSource(['json'], 'json');
    // Passing the key with the extension suffix explicitly
    const result = await ds.createOrUpdate(tmpDir, 'foo.json', 'data', 'json');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.path).toBe('foo');
    }
    // Must not create foo.json.json
    await expect(fs.access(path.join(tmpDir, 'foo.json.json'))).rejects.toThrow();
  });

  it('two keys that differ only in suffix after the last dot are stored at distinct paths', async () => {
    const ds = new FileSystemDataSource(['json'], 'json');
    await ds.createOrUpdate(tmpDir, 'rev/v1.0.0', 'A', 'json');
    await ds.createOrUpdate(tmpDir, 'rev/v1.0.1', 'B', 'json');

    const a = await ds.getFileContents(tmpDir, 'rev/v1.0.0');
    const b = await ds.getFileContents(tmpDir, 'rev/v1.0.1');
    expect(Result.isSuccess(a) && a.success.content).toBe('A');
    expect(Result.isSuccess(b) && b.success.content).toBe('B');
  });
});

describe('FileSystemDataSource stripExtension respects availableExtensions (LCMS-278)', () => {
  it('releases/v1.2-notes and releases/v1.9-notes do not collide onto the same file', async () => {
    const ds = new FileSystemDataSource(['json'], 'json');

    const first = await ds.createOrUpdate(tmpDir, 'releases/v1.2-notes', '{"title":"v1.2 release"}', 'json');
    expect(Result.isSuccess(first)).toBe(true);
    if (Result.isSuccess(first)) {
      expect(first.success.path).toBe('releases/v1.2-notes');
    }

    const second = await ds.createOrUpdate(
      tmpDir,
      'releases/v1.9-notes',
      '{"title":"v1.9 release - DIFFERENT"}',
      'json',
    );
    expect(Result.isSuccess(second)).toBe(true);
    if (Result.isSuccess(second)) {
      expect(second.success.path).toBe('releases/v1.9-notes');
    }

    // Two distinct on-disk files, not one shared v1.json.
    await fs.access(path.join(tmpDir, 'releases/v1.2-notes.json'));
    await fs.access(path.join(tmpDir, 'releases/v1.9-notes.json'));
    await expect(fs.access(path.join(tmpDir, 'releases/v1.json'))).rejects.toThrow();

    const readFirst = await ds.getFileContents(tmpDir, 'releases/v1.2-notes');
    const readSecond = await ds.getFileContents(tmpDir, 'releases/v1.9-notes');
    expect(Result.isSuccess(readFirst) && readFirst.success.content).toBe('{"title":"v1.2 release"}');
    expect(Result.isSuccess(readSecond) && readSecond.success.content).toBe('{"title":"v1.9 release - DIFFERENT"}');
  });

  it('posts/photo.jpg is preserved unchanged when registry is { json } (jpg is not a registered extension)', async () => {
    const ds = new FileSystemDataSource(['json'], 'json');
    const created = await ds.createOrUpdate(tmpDir, 'posts/photo.jpg', '{"caption":"x"}', 'json');

    expect(Result.isSuccess(created)).toBe(true);
    if (Result.isSuccess(created)) {
      expect(created.success.path).toBe('posts/photo.jpg');
    }
    await fs.access(path.join(tmpDir, 'posts/photo.jpg.json'));
    await expect(fs.access(path.join(tmpDir, 'posts/photo.json'))).rejects.toThrow();
  });

  it('notes/hello.json strips to notes/hello when json is a registered extension', async () => {
    const ds = new FileSystemDataSource(['json'], 'json');
    const result = await ds.createOrUpdate(tmpDir, 'notes/hello.json', '{}', 'json');

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.path).toBe('notes/hello');
    }
    await fs.access(path.join(tmpDir, 'notes/hello.json'));
    await expect(fs.access(path.join(tmpDir, 'notes/hello.json.json'))).rejects.toThrow();
  });
});

describe('FileSystemDataSource non-serializer extensions round-trip unchanged (LCMS-540)', () => {
  it('createOrUpdate + getFileContents round-trips uploads/pic.png as uploads/pic.png (png is not a registered serializer)', async () => {
    const ds = new FileSystemDataSource(['json'], 'json');
    const created = await ds.createOrUpdate(tmpDir, 'uploads/pic.png', '{"data":"..."}', 'json');

    expect(Result.isSuccess(created)).toBe(true);
    if (Result.isSuccess(created)) {
      expect(created.success.path).toBe('uploads/pic.png');
    }
    // Physical file carries the real serializer extension, not a truncated one.
    await fs.access(path.join(tmpDir, 'uploads/pic.png.json'));
    await expect(fs.access(path.join(tmpDir, 'uploads/pic.json'))).rejects.toThrow();

    const read = await ds.getFileContents(tmpDir, 'uploads/pic.png');
    expect(Result.isSuccess(read)).toBe(true);
    if (Result.isSuccess(read)) {
      expect(read.success.path).toBe('uploads/pic.png');
      expect(read.success.extension).toBe('json');
    }
  });

  it('a key with multiple dots and an unregistered extension stays intact end-to-end', async () => {
    const ds = new FileSystemDataSource(['json'], 'json');
    const created = await ds.createOrUpdate(tmpDir, 'uploads/nested/file.with.dots.jpg', '{}', 'json');

    expect(Result.isSuccess(created)).toBe(true);
    if (Result.isSuccess(created)) {
      expect(created.success.path).toBe('uploads/nested/file.with.dots.jpg');
    }

    const read = await ds.getFileContents(tmpDir, 'uploads/nested/file.with.dots.jpg');
    expect(Result.isSuccess(read)).toBe(true);
    if (Result.isSuccess(read)) {
      expect(read.success.path).toBe('uploads/nested/file.with.dots.jpg');
    }
  });

  it('a key with a registered serializer extension still strips it (content/posts/entry.md -> content/posts/entry)', async () => {
    const ds = new FileSystemDataSource(['md', 'json'], 'md');
    const created = await ds.createOrUpdate(tmpDir, 'content/posts/entry.md', '# Hi', 'md');

    expect(Result.isSuccess(created)).toBe(true);
    if (Result.isSuccess(created)) {
      expect(created.success.path).toBe('content/posts/entry');
    }

    const read = await ds.getFileContents(tmpDir, 'content/posts/entry');
    expect(Result.isSuccess(read)).toBe(true);
    if (Result.isSuccess(read)) {
      expect(read.success.path).toBe('content/posts/entry');
      expect(read.success.extension).toBe('md');
    }
  });
});

describe('FileSystemDataSource.fsStat (error mapping)', () => {
  it('maps ENOENT to NotFoundError', async () => {
    const ds = new FileSystemDataSource([], '');
    const result = await ds.fsStat(path.join(tmpDir, 'missing'));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('not_found');
    }
  });

  it('returns a Stats object for an existing file', async () => {
    const ds = new FileSystemDataSource([], '');
    await fs.writeFile(path.join(tmpDir, 'f.txt'), 'x');
    const result = await ds.fsStat(path.join(tmpDir, 'f.txt'));
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.isFile()).toBe(true);
    }
  });
});

describe('FileSystemDataSource path-traversal guard (LCMS-199)', () => {
  it('getFileContents rejects ../ key — returns InvalidData, never reads outside root', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    // plant a "secret" one level above tmpDir
    const secretPath = path.join(path.dirname(tmpDir), 'secret-lcms199.md');
    await fs.writeFile(secretPath, 'TOP SECRET');
    try {
      const result = await ds.getFileContents(tmpDir, '../secret-lcms199');
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe('invalid_data');
      }
    } finally {
      await fs.rm(secretPath, { force: true });
    }
  });

  it('createOrUpdate rejects ../ key — returns InvalidData, never writes outside root', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    const escapedPath = path.join(path.dirname(tmpDir), 'escape-lcms199.md');
    const result = await ds.createOrUpdate(tmpDir, '../escape-lcms199', 'INJECTED', 'md');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('invalid_data');
    }
    // File must NOT have been created outside the root
    await expect(fs.access(escapedPath)).rejects.toThrow();
  });

  it('getDirectoryContents rejects ../ key — returns InvalidData, never lists outside root', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    const result = await ds.getDirectoryContents(tmpDir, '..');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('invalid_data');
    }
  });

  it('getDirMeta rejects ../ key — returns InvalidData', async () => {
    const ds = new FileSystemDataSource([], '');
    const result = await ds.getDirMeta(tmpDir, '..');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('invalid_data');
    }
  });

  it('getFileSystemEntry rejects ../ key — returns InvalidData', async () => {
    const ds = new FileSystemDataSource([], '');
    const result = await ds.getFileSystemEntry(tmpDir, '..', 'dir');
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.code).toBe('invalid_data');
    }
  });

  it('isDir rejects ../ key — throws InvalidData', async () => {
    const ds = new FileSystemDataSource([], '');
    await expect(ds.isDir(tmpDir, '..')).rejects.toMatchObject({ code: 'invalid_data' });
  });

  it('findExistingFileExtension rejects ../ key — returns null', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    const result = await ds.findExistingFileExtension(tmpDir, '../secret-lcms199');
    expect(result).toBeNull();
  });

  it('legitimate nested paths are not rejected', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    await ds.createOrUpdate(tmpDir, 'sub/doc', 'hello', 'md');
    const result = await ds.getFileContents(tmpDir, 'sub/doc');
    expect(Result.isSuccess(result)).toBe(true);
  });

  it('deeply nested path that stays within root is allowed', async () => {
    const ds = new FileSystemDataSource(['md'], 'md');
    await fs.mkdir(path.join(tmpDir, 'a/b'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'a/b/doc.md'), 'body');
    const result = await ds.getFileContents(tmpDir, 'a/b/doc');
    expect(Result.isSuccess(result)).toBe(true);
  });
});
