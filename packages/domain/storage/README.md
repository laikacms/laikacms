# @laikacms/storage

[![npm](https://img.shields.io/npm/v/@laikacms/storage)](https://www.npmjs.com/package/@laikacms/storage)
[![npm](https://img.shields.io/npm/dm/@laikacms/storage)](https://www.npmjs.com/package/@laikacms/storage)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@laikacms/storage)](https://bundlephobia.com/result?p=@laikacms/storage)

Core storage abstractions for Laika CMS.

## Installation

```bash
pnpm add @laikacms/storage
```

## Usage

```typescript
import { StorageRepository, StorageObject, Atom } from '@laikacms/storage'
```

## Entities

- `StorageObject` - A stored object with key and content
- `Atom` - Generic storage item (object or folder)
- `Folder` - A container for atoms
- `Pagination` - Pagination parameters

## Repository Interface

```typescript
abstract class StorageRepository {
  abstract getObject(key: Key): ResultStream<StorageObject>
  abstract createObject(create: StorageObjectCreate): ResultStream<StorageObject>
  abstract updateObject(update: StorageObjectUpdate): ResultStream<StorageObject>
  abstract listAtoms(folderKey: Key, options: ListAtomsOptions): ResultStream<readonly Atom[]>
  // ...
}
```

## Implementations

- `@laikacms/storage-r2` - Cloudflare R2
- `@laikacms/storage-fs` - Local filesystem
- `@laikacms/storage-drizzle` - SQL via Drizzle ORM
