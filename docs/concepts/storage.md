# Storage

The storage protocol is the foundation everything else builds on: uniquely addressable content with
no assumptions about its shape. It is the narrowest contract — a key and a content object — and
every [backend](../backends/fs) implements it.

## Atoms and folders

The storage domain speaks in **atoms**. An atom is either a **storage object** (a leaf holding your
content) or a **folder** (a grouping). Keys are arbitrary path-like strings such as
`posts/hello-world`; folders come from the slashes in those keys. These wrappers carry your content
— they are not a data model imposed on it.

A **key** is the unique address of an object, such as `src/blog/hello-world.md` or
`94c3f782-cf80-44c7-a9d3-79a49a367dbe`. It is called a key rather than an ID because filenames and
other path-like values are valid addresses too. Slashes form folder boundaries; the remaining key
format belongs to the repository and its data model — there is deliberately no global set of allowed
characters.

## The `content` object is yours

The protocol knows only atoms, folders, keys, metadata, and summaries. The `content` field on an
object is your own arbitrary JSON and is **never interpreted** by the protocol. That is what lets
the same core drive a blog, a product catalogue, or a settings store without changes.

Content is always an object — never a bare primitive. A number cannot later gain metadata without
changing its type; `{ "temperatureDegrees": 24 }` can gain fields without breaking the contract.

## The `body` convention

When all you have is a raw string (plain text, markdown, HTML, …), the convention is to wrap it in a
`body` field:

```json
{ "title": "Hello", "tags": ["intro"], "body": "# Hello\n\nMy first post." }
```

The protocol never interprets this — but [serializers](../serializers/) build on it: the raw
serializer persists exactly the `body` field as plain text, and the markdown serializer writes
`body` as the document body with the remaining fields as frontmatter.

## Core operations

```typescript
import { collectStream, runTask } from 'laikacms/compat';

await runTask(repo.createObject({ key: 'posts/hello', type: 'object', content: { title: 'Hi' } }));
const post = await runTask(repo.getObject('posts/hello'));
const { items } = await collectStream(repo.listAtoms('posts', { depth: 1, pagination: {} }));
await runTask(repo.removeAtoms(['posts/hello']));
```

Not every backend can do everything — capabilities (e.g. change tracking) are discovered at runtime
via `getCapabilities()`, so composed layers can adapt instead of failing.

## Going deeper

- [Backends](../backends/fs) — every official `StorageRepository` implementation
- [Serializers](../serializers/) — how content objects become files
- [Storage API reference](../reference/json-api/storage) — the protocol over HTTP
- [Glossary](../reference/glossary) — versions, sync tokens, and the change feed (optional,
  capability-gated change tracking)
