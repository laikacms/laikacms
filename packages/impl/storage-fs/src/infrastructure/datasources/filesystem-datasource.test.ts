import * as Result from 'effect/Result';
import * as fs from 'fs/promises';
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
    await expect(ds.isDir(tmpDir, 'missing')).rejects.toThrow(/does not exist/);
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
