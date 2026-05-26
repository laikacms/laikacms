# @laikacms/convex

[Convex](https://convex.dev)-backed implementations of Laika CMS contracts. First (and current)
export: **`@laikacms/convex/storage-convex`** — a `StorageRepository` over the Convex HTTP RPC
endpoint.

Runtime-agnostic — only depends on `fetch`.

```bash
pnpm add @laikacms/convex
```

## Why a Convex package

Convex is a reactive database where queries and mutations are **server-side TypeScript functions**,
not query strings. Clients invoke these by _name_ over HTTP. Five architectural traits set it apart
from every prior backend in the Laika suite:

**1. Named-function RPC as the query primitive.** The wire shape is `POST /api/query` (or
`/api/mutation`) with body:

```json
{ "path": "laika:getFile", "args": { "parent": "notes", "name": "hello" }, "format": "json" }
```

The function name travels in the body under `path`, not the URL. **First "platform-as-API" backend
in the suite** — no SQL, Mango, Cypher, EdgeQL, or any other query DSL. The query "language" is
TypeScript on the Convex side.

**2. `{status, value | errorMessage}` envelope.** Every response — regardless of HTTP status — wraps
the payload:

```json
{ "status": "success", "value": { /* … */ } }
{ "status": "error",   "errorMessage": "Document not found: notes/x" }
```

**First backend with explicit success/error discriminator at the envelope level** (not just HTTP
status). The data source unwraps this automatically and maps `error` responses to typed Laika errors
via pattern matching on the message.

**3. Query / Mutation / Action triad.** Convex distinguishes:

- **Queries** — pure reads, deterministic, can be subscribed to
- **Mutations** — database writes, transactional
- **Actions** — side-effecting calls (e.g. external HTTP)

The repository uses only `query` and `mutation`. **First backend with read/write/side-effect
endpoint distinction.**

**4. Transactional mutations.** Every mutation call runs as one transaction. `removeAtoms(N)` ships
as ONE mutation call (`laika:removeFiles`) with the full path array; the user's function deletes N
rows inside one transaction. The atomicity lives in the user-written function, not the wire
protocol.

**5. Per-deployment URL.** Each Convex deployment has its own hostname like
`https://<deployment-slug>.convex.cloud`. **No database name in the URL** — the deployment IS the
database.

## Usage

```ts
import { ConvexDataSource, ConvexStorageRepository } from '@laikacms/convex/storage-convex';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new ConvexDataSource({
  url: 'https://my-app.convex.cloud',
  auth: { accessToken: process.env.CONVEX_AUTH_TOKEN }, // optional
});

const repo = new ConvexStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Required Convex functions

The repository invokes a fixed set of named functions in the user's Convex project. Copy this
reference module into `convex/laika.ts`:

```ts
// convex/laika.ts
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const fileShape = {
  path: v.string(),
  parent: v.string(),
  name: v.string(),
  extension: v.string(),
  content: v.string(),
  createdAt: v.string(),
  updatedAt: v.string(),
};
const folderShape = {
  path: v.string(),
  parent: v.string(),
  name: v.string(),
  createdAt: v.string(),
  updatedAt: v.string(),
};

export const getFile = query({
  args: { parent: v.string(), name: v.string() },
  handler: async (ctx, { parent, name }) => {
    return await ctx.db
      .query('laika_files')
      .withIndex('by_parent_name', q => q.eq('parent', parent).eq('name', name))
      .first();
  },
});

export const getFolder = query({
  args: { path: v.string() },
  handler: async (ctx, { path }) => {
    return await ctx.db
      .query('laika_folders')
      .withIndex('by_path', q => q.eq('path', path))
      .first();
  },
});

export const listChildren = query({
  args: { parent: v.string() },
  handler: async (ctx, { parent }) => {
    const files = await ctx.db.query('laika_files')
      .withIndex('by_parent', q => q.eq('parent', parent)).collect();
    const folders = await ctx.db.query('laika_folders')
      .withIndex('by_parent', q => q.eq('parent', parent)).collect();
    return [
      ...files.map(f => ({
        _id: f._id,
        type: 'file',
        path: f.path,
        parent: f.parent,
        name: f.name,
        extension: f.extension,
      })),
      ...folders.map(f => ({
        _id: f._id,
        type: 'folder',
        path: f.path,
        parent: f.parent,
        name: f.name,
      })),
    ];
  },
});

export const hasDescendants = query({
  args: { parent: v.string() },
  handler: async (ctx, { parent }) => {
    const f = await ctx.db.query('laika_files')
      .withIndex('by_parent', q => q.eq('parent', parent)).first();
    if (f) return true;
    const d = await ctx.db.query('laika_folders')
      .withIndex('by_parent', q => q.eq('parent', parent)).first();
    return d !== null;
  },
});

export const createFile = mutation({
  args: fileShape,
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('laika_files')
      .withIndex('by_path', q => q.eq('path', args.path)).first();
    if (existing) throw new Error(`Document already exists: ${args.path}`);
    return await ctx.db.insert('laika_files', args);
  },
});

export const updateFile = mutation({
  args: { path: v.string(), content: v.string(), updatedAt: v.string() },
  handler: async (ctx, { path, content, updatedAt }) => {
    const existing = await ctx.db.query('laika_files')
      .withIndex('by_path', q => q.eq('path', path)).first();
    if (!existing) throw new Error(`Document not found: ${path}`);
    await ctx.db.patch(existing._id, { content, updatedAt });
    return await ctx.db.get(existing._id);
  },
});

export const upsertFile = mutation({
  args: fileShape,
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('laika_files')
      .withIndex('by_path', q => q.eq('path', args.path)).first();
    if (existing) {
      await ctx.db.patch(existing._id, { content: args.content, updatedAt: args.updatedAt });
      return await ctx.db.get(existing._id);
    }
    return await ctx.db.insert('laika_files', args);
  },
});

export const upsertFolder = mutation({
  args: folderShape,
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('laika_folders')
      .withIndex('by_path', q => q.eq('path', args.path)).first();
    if (existing) return existing;
    return await ctx.db.insert('laika_folders', args);
  },
});

export const removeFiles = mutation({
  args: { paths: v.array(v.string()) },
  handler: async (ctx, { paths }) => {
    const removed: string[] = [];
    const missing: string[] = [];
    for (const path of paths) {
      const existing = await ctx.db.query('laika_files')
        .withIndex('by_path', q => q.eq('path', path)).first();
      if (existing) {
        await ctx.db.delete(existing._id);
        removed.push(path);
      } else {
        missing.push(path);
      }
    }
    return { removed, missing };
  },
});
```

Schema (`convex/schema.ts`):

```ts
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  laika_files: defineTable({
    path: v.string(),
    parent: v.string(),
    name: v.string(),
    extension: v.string(),
    content: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_path', ['path'])
    .index('by_parent', ['parent'])
    .index('by_parent_name', ['parent', 'name']),

  laika_folders: defineTable({
    path: v.string(),
    parent: v.string(),
    name: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index('by_path', ['path'])
    .index('by_parent', ['parent']),
});
```

Deploy with `npx convex deploy`.

## Custom function paths

If the reference module doesn't fit your project layout, override the function paths:

```ts
new ConvexStorageRepository({
  dataSource,
  serializerRegistry,
  defaultFileExtension: 'md',
  functions: {
    getFile: 'cms/files:get', // module: cms/files, function: get
    createFile: 'cms/files:create',
    // … etc
  },
});
```

## Operation mapping

| Laika operation             | Convex function                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `getObject(key)`            | `query` → `laika:getFile`                                                                     |
| `createObject(key, …)`      | `query` → `laika:getFile` (probe) + `mutation` → `laika:createFile`                           |
| `updateObject(key, …)`      | `query` → `laika:getFile` + `mutation` → `laika:updateFile`                                   |
| `createOrUpdateObject`      | `query` → `laika:getFile` + `mutation` → `laika:upsertFile`                                   |
| `createFolder(key)`         | `mutation` → `laika:upsertFolder`                                                             |
| `removeAtoms([k₁…kₙ])`      | n × `query` → `laika:getFile` + **1 × `mutation` → `laika:removeFiles`** with full path array |
| `listAtomSummaries(folder)` | `query` → `laika:listChildren`                                                                |
| `getCapabilities()`         | (no I/O — static)                                                                             |

## What this iteration does NOT add

`removeAtoms(N)` ships as ONE mutation call — but the _atomicity_ lives in the user-written Convex
function, not the wire protocol. The wire protocol is just RPC. **Not a new atomic-multi-write
mechanism** in the spirit of SurrealDB's `BEGIN/COMMIT`, Neo4j's `{statements: [...]}`, or Gel's
`FOR ... UNION (...)`. The novelty here is in the named-function RPC and the platform-as-API model.

## Caveats

- **Functions must exist on the Convex side.** The package can't fully manage them — you're
  responsible for deploying the reference module (or your own variant). The function-path option
  lets you rename, but the argument shapes are fixed.
- **No subscriptions.** Convex's headline feature is reactive subscriptions over WebSocket. This
  package uses only HTTP RPC.
- **Convex's `_id` is a short opaque string** (e.g. `j97a8f3...`). We surface it as
  `metadata.revisionId`. It changes when the row is deleted-then-recreated — not a content hash like
  AT Protocol.
- **String-content limit.** Convex limits document size to 1 MiB (default). For CMS use cases this
  is usually fine; for larger payloads use Convex File Storage and store a reference here.
