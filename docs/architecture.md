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
  abstract getObject(key: string): ResultStream<StorageObject>;
  abstract createObject(create: StorageObjectCreate): ResultStream<StorageObject>;
}

// Implementation provides concrete behavior
class R2StorageRepository extends StorageRepository {
  async *getObject(key: string): ResultStream<StorageObject> {
    const object = await this.bucket.get(key);
    if (!object) {
      yield Result.fail(new NotFoundError(`Not found: ${key}`));
      return;
    }
    yield Result.succeed({ key, content: await object.text() });
  }
}
```

### Result Streams

All repository methods return `AsyncGenerator<LaikaResult<T>>` for streaming results with error
handling.

```typescript
const gen = repo.listAtoms({ prefix: 'posts/' });
for await (const result of gen) {
  if (Result.isSuccess(result)) {
    console.log(result.value);
  }
}
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

// Works with any Standard Schema compatible library
repo.createObject({ key: 'posts/hello', content: data, schema: PostSchema });
```
