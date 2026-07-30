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
  abstract getObject(key: Key): LaikaTask.LaikaTask<StorageObject>;
  abstract createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject>;
  abstract listAtoms(
    folderKey: Key,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<Atom, ListAtomsDone>;
}

// Implementation provides concrete behavior
class R2StorageRepository extends StorageRepository {
  getObject(key: Key): LaikaTask.LaikaTask<StorageObject> {
    // build callback returns Effect.Effect<StorageObject, LaikaError>
    return LaikaTask.make(() =>
      Effect.tryPromise({
        try: async () => {
          const object = await this.bucket.get(key);
          if (!object) throw new NotFoundError(`Not found: ${key}`);
          return { key, content: await object.text() };
        },
        catch: err => err instanceof LaikaError ? err : new UnknownError(err),
      })
    );
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

LaikaCMS exports its entity types as
[Standard Schema v1](https://github.com/standard-schema/standard-schema) compatible schemas.
Consumers can use these directly with Zod, Valibot, ArkType, or any Standard-Schema-compatible
validator.

```typescript
import { StorageObjectSchema } from 'laikacms/storage';

// StorageObjectSchema satisfies StandardSchemaV1 — parse with any compatible library
const result = StorageObjectSchema['~standard'].validate(unknownPayload);

// Content validation is the caller's responsibility before calling createObject —
// StorageRepository.createObject accepts StorageObjectCreate (key + content + optional metadata)
// and does not perform schema validation on the content field.
const parsed = PostSchema.parse(rawContent); // validate first
await runTask(repo.createObject({ key: 'posts/hello', content: parsed }));
```
