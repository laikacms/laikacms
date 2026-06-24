# laikacms/storage

[![npm](https://img.shields.io/npm/v/laikacms/storage)](https://www.npmjs.com/package/laikacms/storage)
[![npm](https://img.shields.io/npm/dm/laikacms/storage)](https://www.npmjs.com/package/laikacms/storage)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/laikacms/storage)](https://bundlephobia.com/result?p=laikacms/storage)

Core storage abstractions for Laika CMS.

## Installation

```bash
pnpm add laikacms/storage
```

## Usage

```typescript
import { Atom, StorageObject, StorageRepository } from 'laikacms/storage';
```

## Return types

Methods return one of two effect types from `laikacms/core`:

- `LaikaTask.LaikaTask<T>` — resolves to a single value (async, like a Promise)
- `LaikaStream.LaikaStream<T, Done>` — emits multiple values and then a done value (streaming)

## Entities

- `StorageObject` - A stored object with key and content
- `StorageObjectCreate` - Input type for creating a storage object
- `StorageObjectUpdate` - Input type for updating a storage object
- `Atom` - Generic storage item (object or folder)
- `AtomSummary` - Lightweight summary of an atom, used when listing
- `Folder` - A container for atoms
- `FolderCreate` - Input type for creating a folder
- `Capabilities` - Describes what the storage backend supports
- `ListAtomsDone` - Type alias for `LaikaDone`; carries pagination and total via the base interface
- `RemoveAtomsDone` - Done value returned by `removeAtoms`; includes `removed` and `skipped` counts

## Repository Interface

```typescript
abstract class StorageRepository {
  // Storage Objects (formerly Files)
  abstract getObject(key: Key): LaikaTask.LaikaTask<StorageObject>;
  abstract createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject>;
  abstract updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject>;
  abstract createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject>;

  // Folders (formerly Directories)
  abstract getFolder(key: Key): LaikaTask.LaikaTask<Folder>;
  abstract createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder>;
  abstract listAtomSummaries(
    folderKey: Key,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone>;
  abstract listAtoms(
    folderKey: Key,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<Atom, ListAtomsDone>;

  // Atoms (formerly Entries)
  abstract getAtom(key: Key): LaikaTask.LaikaTask<Atom>;
  abstract removeAtoms(keys: readonly Key[]): LaikaStream.LaikaStream<Key, RemoveAtomsDone>;

  // Other
  abstract getCapabilities(): LaikaTask.LaikaTask<Capabilities>;
}
```

## Implementations

- `laikacms/storage-r2` - Cloudflare R2
- `laikacms/storage-fs` - Local filesystem
- `laikacms/storage-drizzle` - SQL via Drizzle ORM
- `laikacms/storage-s3` - Amazon S3
- `laikacms/storage-webdav` - WebDAV-compatible servers
- `laikacms/storage-jsonapi-proxy` - JSON:API proxy
