import path from 'path';
import posixPath from 'path/posix';
import os from 'os';
import fs from 'fs/promises';
import {
  DirInsteadOfFile,
  failure,
  FileInsteadOfDir,
  ForbiddenError,
  InternalError,
  NotFoundError,
  Result,
  ResultError,
  success
} from '@laikacms/core';
import { exec } from 'child_process';
import trash from 'trash'
import { DirSub, FileOrDir } from '../../domain/entities/file.js';
import { pathCombine, pathToSegments } from '@laikacms/storage';
import { JSONSchema7 } from 'json-schema';

const ALLOW_RECURSIVE = false

const get = (obj: any, key: string): any => {
  if (typeof obj !== 'object' || obj === null) return undefined;
  return obj ? obj[key] : undefined;
}

export class FileSystemDataSource {
  constructor(
    private readonly availableExtensions: string[] = [],
    private readonly defaultFileExtension: string = ''
  ) {}

  /**
   * Strip any extension from the path if it matches one of the available extensions.
   * This ensures the interface never exposes file extensions.
   */
  private stripExtension(relativePath: string): string {
    for (const ext of this.availableExtensions) {
      if (relativePath.endsWith(`.${ext}`)) {
        return relativePath.slice(0, -(ext.length + 1));
      }
    }
    return relativePath;
  }

  /**
   * Resolve a relative path (without extension) to the actual file path with extension.
   * Tries to find the file with any available extension.
   * Returns the resolved path with extension, or null if not found.
   */
  private async resolvePathWithExtension(
    basePath: string,
    relativePath: string
  ): Promise<string | null> {
    // Strip any extension that user may have mistakenly added
    const pathWithoutExt = this.stripExtension(relativePath);
    
    // Try to find file with any available extension
    for (const ext of this.availableExtensions) {
      const pathWithExt = `${pathWithoutExt}.${ext}`;
      const fullPath = path.join(basePath, pathWithExt);
      
      try {
        await fs.access(fullPath);
        // File exists with this extension
        return pathWithExt;
      } catch {
        // File doesn't exist with this extension, try next
        continue;
      }
    }
    
    // No file found with any extension
    return null;
  }

  /**
   * Check if a file exists with any of the available extensions.
   * Returns the extension if found, null otherwise.
   */
  async findExistingFileExtension(
    basePath: string,
    relativePath: string
  ): Promise<string | null> {
    const pathWithoutExt = this.stripExtension(relativePath);
    
    for (const ext of this.availableExtensions) {
      const pathWithExt = `${pathWithoutExt}.${ext}`;
      const fullPath = path.join(basePath, pathWithExt);
      
      try {
        await fs.access(fullPath);
        return ext;
      } catch {
        continue;
      }
    }
    
    return null;
  }

  deleteEntries = async (
    basePath: string,
    entries: readonly DirSub[]
  ): Promise<Result<DirSub[]>> => {
    const checkResults = await Promise.allSettled(
      entries.map(async (entry) => {
        const fullPath = path.join(basePath, entry.path);
        const stat = await fs.stat(fullPath)
        if (stat.isDirectory() && entry.type !== 'dir') {
          throw new DirInsteadOfFile(`The path ${fullPath} is a directory`)
        }
        if (stat.isFile() && entry.type !== 'file') {
          throw new DirInsteadOfFile(`The path ${fullPath} is a directory`)
        }
        if (!stat.isFile() && !stat.isDirectory()) {
          throw new ForbiddenError(`Currently only files and directories can be deleted`)
        }
        if (entry.type === 'dir') {
          const listing = await fs.readdir(fullPath)
          if (listing.length > 0 && !ALLOW_RECURSIVE) {
            throw new ForbiddenError('Due to security concerns, deleting directories with content is not allowed')
          }
        }
        return entry
      })
    )
    const successful = checkResults.filter((result) => result.status === 'fulfilled').map((result) => result.value)
    const failed = checkResults.filter((result) => result.status === 'rejected').map((result) => {
      switch(result.reason.code) {
        case 'ENOENT':
          return new NotFoundError(`The file at ${result.reason.path} does not exist`)
        case 'EPERM':
          return new ForbiddenError(`The file at ${result.reason.path} could not be deleted because you don't have the necessary permissions`)
        case 'EACCES':
          return new ForbiddenError(`The file at ${result.reason.path} could not be deleted because you don't have access to it`)
        case 'ENOTEMPTY':
          return new ForbiddenError(`The directory at ${result.reason.path} could not be deleted because it is not empty`)
        case 'EISDIR':
          return new DirInsteadOfFile(`The path ${result.reason.path} is a directory`)
        case 'EEXIST':
          return new FileInsteadOfDir(`The path ${result.reason.path} is a file`)
        default:
          return result.reason
      }
    })
    await trash(successful.map((entry) => path.join(basePath, entry.path)))
    return success(successful, failed)
  }

  getFileContents = async (
    basePath: string,
    relativePath: string
  ): Promise<Result<{ content: string; path: string; extension: string }>> => {
    try {
      const resolvedPath = await this.resolvePathWithExtension(basePath, relativePath);
      
      if (!resolvedPath) {
        return failure(NotFoundError.CODE, [`The file at ${relativePath} does not exist`]);
      }
      
      const fullPath = path.join(basePath, resolvedPath);
      const content = (await fs.readFile(fullPath)).toString('utf8');
      
      // Extract extension from resolved path
      const lastDot = resolvedPath.lastIndexOf('.');
      const extension = lastDot > 0 ? resolvedPath.slice(lastDot + 1) : '';
      
      // Return path without extension for the interface
      const pathWithoutExt = this.stripExtension(resolvedPath);
      
      return success({ content, path: pathWithoutExt, extension });
    } catch (error) {
      console.error(error);
      if (get(error, 'code') === 'ENOENT') {
        throw new NotFoundError(`The file at ${relativePath} does not exist`);
      } else {
        throw error;
      }
    }
  };

  getFileMeta = async (
    basePath: string,
    relativePath: string
  ): Promise<Result<{ size: number; createdAt: Date, updatedAt: Date, path: string; extension: string }>> => {
    try {
      const resolvedPath = await this.resolvePathWithExtension(basePath, relativePath);
      
      if (!resolvedPath) {
        return failure(NotFoundError.CODE, [`The file at ${relativePath} does not exist`]);
      }
      
      const fullPath = path.join(basePath, resolvedPath);
      const { size, ctime, mtime } = await fs.stat(fullPath);
      
      // Extract extension from resolved path
      const lastDot = resolvedPath.lastIndexOf('.');
      const extension = lastDot > 0 ? resolvedPath.slice(lastDot + 1) : '';
      
      // Return path without extension for the interface
      const pathWithoutExt = this.stripExtension(resolvedPath);
      
      return success({ size, createdAt: ctime, updatedAt: mtime, path: pathWithoutExt, extension });
    } catch (error) {
      console.error(error);
      if (get(error, 'code') === 'ENOENT') {
        return failure(NotFoundError.CODE, [`The file at ${relativePath} does not exist`]);
      } else {
        // TODO: log error
        return failure(InternalError.CODE, [`Failed to get file metadata`]);
      }
    }
  };

  getDirMeta = async (
    basePath: string,
    relativePath: string
  ): Promise<Result<{ createdAt: Date, updatedAt: Date }>> => {
    try {
      const fullPath = path.join(basePath, relativePath);
      const { ctime, mtime } = await fs.stat(fullPath);
      return success({ createdAt: ctime, updatedAt: mtime });
    } catch (error) {
      console.error(error);
      if (get(error, 'code') === 'ENOENT') {
        return failure(NotFoundError.CODE, [`The directory at ${relativePath} does not exist`]);
      } else {
        return failure(InternalError.CODE, [`Failed to get directory metadata`]);
      }
    }
  };

  private listWin32Drives = (): Promise<Result<DirSub[]>> => {
    return new Promise((resolve, reject) => {
      exec('wmic logicaldisk get name', (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        if (stderr) {
          resolve(failure(InternalError.CODE, [`Failed to list drives`]));
          return;
        }
        const drives = stdout
          .split('\n')
          .filter((line) => /^[A-Za-z]:/.test(line)) // Match lines like "C:"
          .map((line) => line.trim());

        resolve(
          success(drives.map((drive) => ({
            type: 'dir',
            path: drive,
          })))
        );
      });
    });
  };

  private listDirectory = async (fullPath: string): Promise<Result<DirSub[]>> => {
    const isRoot =
      path.normalize(fullPath) === path.normalize(path.resolve(fullPath, '/'));
    if (os.platform() === 'win32') {
      if (isRoot) {
        return await this.listWin32Drives();
      } else {
        const [driveLetter, ...rest] = pathToSegments(path.posix.normalize(fullPath));
        fullPath = path.win32.normalize(pathCombine(driveLetter + ':', ...rest));
      }
    }
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return success(entries
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => ({
        type: entry.isDirectory() ? 'dir' : ('file' as const),
        path: posixPath.join(fullPath, entry.name),
      })));
  };

  getDirectoryContents = async (
    basePath: string,
    relativePath: string,
  ): Promise<Result<DirSub[]>> => {
    const fullPath = path.join(basePath, relativePath);
    try {
      const listing = await this.listDirectory(fullPath);
      if (!listing.success) return listing;
      const remapped = listing.data.map((entry) => ({
        type: entry.type,
        path: path.relative(basePath, entry.path),
      }))
      return success(remapped);
    } catch (error) {
      console.error(error);
      if (get(error, 'code') === 'ENOENT') {
        throw new NotFoundError(`The directory at ${fullPath} does not exist`);
      } else {
        throw error;
      }
    }
  };

  createOrUpdate = async (
    basePath: string,
    relativePath: string,
    content: string,
    extension: string
  ): Promise<Result<{ path: string }>> => {
    // Strip any extension user may have added and use the provided extension
    const pathWithoutExt = this.stripExtension(relativePath);
    const pathWithExt = `${pathWithoutExt}.${extension}`;
    const fullPath = path.join(basePath, pathWithExt);
    const dirPath = path.dirname(fullPath);
  
    try {
      // Check if the directory exists, if not create it
      try {
        await fs.access(dirPath);
      } catch {
        await fs.mkdir(dirPath, { recursive: true });
      }
  
      // Write the file
      await fs.writeFile(fullPath, content);
  
      // Return path without extension for the interface
      return success(
        { path: pathWithoutExt }
      );
    } catch (error) {
      console.error(error);
      if (get(error, 'code') === 'ENOENT') {
        return ResultError.fromError(
          new NotFoundError(`The directory at ${dirPath} does not exist`)
        ).toResult();
      } else if (get(error, 'code') === 'EACCES') {
        return (ResultError.fromError(
          new ForbiddenError(`Permission denied for ${fullPath}`)
        )).toResult();
      } else {
        return ResultError.fromError(error).toResult();
      }
    }
  };

  isDir = async (basePath: string, relativePath: string): Promise<boolean> => {
    const fullPath = path.join(basePath, relativePath);
    try {
      const stat = await fs.stat(fullPath);
      return stat.isDirectory();
    } catch (error) {
      console.error(error);
      if (get(error, 'code') === 'ENOENT') {
        throw new NotFoundError(`The path at ${relativePath} does not exist`);
      } else {
        throw error;
      }
    }
  };

  getFileSystemEntry = async (
    basePath: string,
    relativePath: string,
    type: 'file' | 'dir' | 'both'
  ): Promise<Result<FileOrDir>> => {
    const fullPath = path.join(basePath, relativePath);

    try {
      const stat = await fs.stat(fullPath);

      if (stat.isDirectory()) {
        if (type === 'file')
          throw new DirInsteadOfFile(
            `When fetching ${relativePath} a file was expected but a directory was found`
          );
        const dirent = await fs.readdir(fullPath, { withFileTypes: true });
        const sub = dirent
          .map((entry) => {
            if (entry.isDirectory()) {
              return {
                type: 'dir' as const,
                path: posixPath.join(relativePath, entry.name)
              };
            } else if (entry.isFile()) {
              return {
                type: 'file' as const,
                path: posixPath.join(relativePath, entry.name)
              };
            } else return undefined;
          })
          .filter(Boolean) as DirSub[];

        const entry = {
          type: 'dir' as const,
          path: relativePath,
          content: sub
        };

        return success(entry);
      } else if (stat.isFile()) {
        if (type === 'dir')
          throw new FileInsteadOfDir(
            `When fetching ${relativePath} a directory was expected but a file was found`
          );
        const content = await fs.readFile(fullPath, 'utf-8');
        return success({
          type: 'file' as const,
          path: relativePath,
          content
        });
      } else {
        throw new ForbiddenError(
          `The path ${fullPath} is not a file or directory`
        );
      }
    } catch (error) {
      console.error(error);
      if (get(error, 'code') === 'ENOENT') {
        throw new NotFoundError(`The directory at ${fullPath} does not exist`);
      } else {
        throw error;
      }
    }
  };

  listFileSystemDirectory = async (
    basePath: string,
    relativePath: string
  ): Promise<Result<DirSub[]>> => {
    try {
      const result = await this.getDirectoryContents(basePath, relativePath);

      return result;
    } catch (error) {
      console.error(error);
      if (error instanceof NotFoundError) {
        return ResultError.fromError(error).toResult();
      }
      return ResultError.fromError(error).toResult();
    }
  };
}
