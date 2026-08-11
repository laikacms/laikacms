# Web Storage

`WebStorageRepository` backs the [Storage protocol](../concepts/storage) with an injectable Web
`Storage` object — `localStorage`, `sessionStorage`, or an in-memory shim. Zero setup in every
browser, which makes it ideal for prototypes, demos, drafts, and tests that need a real
`StorageRepository` without standing up a backend.

## Wire it up

```ts
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { WebStorageRepository } from 'laikacms/storage-web';

const repo = new WebStorageRepository({
  storage: window.localStorage, // optional — defaults to globalThis.localStorage, resolved lazily
  serializerRegistry: { json: jsonSerializer },
  defaultExtension: 'json',
});
```

An in-memory shim makes it SSR- and test-safe — any object implementing the `Storage` interface
(`getItem`, `setItem`, `removeItem`, `key`, `length`, `clear`) works.

## Capability notes

> [!WARNING]
> Web `Storage` is **world-readable to any script on the same origin** — it has no access control,
> and every write is inherently unauthenticated. Never store credentials or other secrets here. It
> is fine for local drafts and scratch content; it is not a substitute for a server once other
> people need to read or write the same content.

- Per-origin and capped at a few MB. For a real hierarchy and much higher quota in the browser, use
  [OPFS](./opfs).
- Writes stay on the visitor's device — the moment content needs to be shared, durable, or
  moderated, it has to go through a server you control.
