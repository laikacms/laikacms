# Architecture

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│                        API Layer                             │
│  (storage-api, documents-api, assets-api, contentbase-api)  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Domain Layer                            │
│        (storage, documents, assets, contentbase-settings)   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Implementation Layer                        │
│   (storage-r2, storage-fs, documents-drizzle, assets-r2)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Shared Layer                             │
│         (core, crypto, sanitizer, i18n, json-api)           │
└─────────────────────────────────────────────────────────────┘
```

## Principles

- **Domain packages** define interfaces, not implementations
- **Implementation packages** depend on domain packages
- **API packages** depend on domain packages (not implementations)
- **Shared packages** have no internal dependencies

## Patterns

### Repository Pattern

```typescript
// Domain defines the interface
abstract class StorageRepository {
  abstract getObject(key: string): LaikaTask<StorageObject>;
  abstract createObject(create: StorageObjectCreate): LaikaTask<StorageObject>;
  abstract listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream<Atom, ListAtomsDone>;
}

// Implementation provides concrete behavior
class R2StorageRepository extends StorageRepository {
  getObject(key: string): LaikaTask<StorageObject> {
    return LaikaTask.make(async emit => {
      const object = await this.bucket.get(key);
      if (!object) throw new NotFoundError(`Not found: ${key}`);
      return { key, content: await object.text() };
    });
  }
}
```

### Result Streams

Repository methods return either `LaikaTask<T>` (single result) or `LaikaStream<T, D>` (multiple
results with a typed done value). Both are Effect-based; use the `laikacms/compat` helpers to
consume them without importing Effect directly.

```typescript
import { collectStream, runTask } from 'laikacms/compat';

// Single result
const object = await runTask(repo.getObject('posts/hello'));

// Stream of results
const { items, done } = await collectStream(
  repo.listAtoms('posts/', { depth: 1, pagination: { offset: 0, limit: 100 } }),
);
console.log(items); // Atom[]
```

## Standard Schema

Validation uses [Standard Schema](https://github.com/standard-schema/standard-schema) for
interoperability with Zod, Valibot, ArkType.

```typescript
import { z } from 'zod';

const PostSchema = z.object({
  title: z.string(),
  content: z.string(),
});

// Works with any Standard Schema compatible library — validation is handled
// by the repository layer, not passed as a createObject option
await runTask(repo.createObject({ key: 'posts/hello', content: data }));
```
