# @laikacms/trello

[Trello](https://trello.com)-backed implementations of Laika CMS
contracts. First (and current) export:
**`@laikacms/trello/storage-trello`** — a `StorageRepository` over a
single Trello board.

Runtime-agnostic — only depends on `fetch`.

```bash
pnpm add @laikacms/trello
```

## Why a Trello package

Trello is a Kanban-style work-tracking product whose data model
maps onto a CMS surprisingly well: boards contain lists, lists
contain cards, and cards carry a Markdown `desc` field that holds
content. Five architectural traits set it apart from every prior
backend in the Laika suite:

**1. Floating-point `pos` ordering.** Every card and list carries a
positive-float `pos` field — Trello uses this for drag-and-drop
ordering. New entries get `pos: 'bottom'` (the API converts this to
a fresh float above all existing entries). **First backend with
native positional ordering at the wire level.**

**2. `?key=…&token=…` URL-parameter authentication.** Trello's REST
API authenticates via query parameters, not the `Authorization`
header:

```http
GET https://api.trello.com/1/boards/abc/lists?filter=open&key=…&token=…
```

**First backend in the suite with query-string-based auth.**

**3. Soft-delete via `closed=true` for lists.** Trello doesn't
expose a physical-delete endpoint for lists — they're "archived" by
setting `closed=true`. Cards CAN be physically deleted
(`DELETE /1/cards/:id`). The two resource types have different
lifecycle semantics — first backend with type-specific
soft-vs-hard delete.

**4. 2-level platform hierarchy maps to N-level Laika paths.** The
repository encodes deep paths into list names:

| Laika key            | Trello mapping                                |
|----------------------|-----------------------------------------------|
| `standalone`         | card `"standalone.md"` in list `"__root__"`   |
| `notes/hello`        | card `"hello.md"` in list `"notes"`           |
| `notes/sub/deep`     | card `"deep.md"` in list `"notes/sub"`        |
| `notes` (folder)     | list named `"notes"`                          |

Root-level files live in a synthesised list named `__root__`.
**First backend that flattens an arbitrary tree into a depth-limited
platform.**

**5. `dateLastActivity` as the server-managed revision.** Trello
updates this timestamp on every card mutation; the repository
surfaces it as `metadata.revisionId`. **First backend using a
server-managed change timestamp as the revision identifier.**

## Usage

```ts
import {
  TrelloDataSource,
  TrelloStorageRepository,
} from '@laikacms/trello/storage-trello';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const dataSource = new TrelloDataSource({
  boardId: 'your-board-id',
  auth: {
    apiKey: process.env.TRELLO_API_KEY!,    // https://trello.com/app-key
    token:  process.env.TRELLO_TOKEN!,      // OAuth 1.0a token
  },
});

const repo = new TrelloStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

## Operation mapping

| Laika operation             | Trello call(s)                                            |
|-----------------------------|-----------------------------------------------------------|
| `getObject(key)`            | 1 × `GET /boards/:id/lists` + 1 × `GET /lists/:id/cards`  |
| `createObject(key, …)`      | 1 × resolve + 1 × `POST /lists` (if needed) + 1 × `POST /cards` |
| `updateObject(key, …)`      | 1 × resolve + 1 × `PUT /cards/:id` (desc)                 |
| `createOrUpdateObject`      | 1 × resolve + 1 × (create or update)                      |
| `createFolder(key)`         | 1 × `GET /boards/:id/lists` + 1 × `POST /lists` if missing |
| `removeAtoms([k₁…kₙ])`      | n × resolve + **n × parallel `DELETE /cards/:id`** (Trello has no bulk endpoint) |
| `listAtomSummaries(folder)` | 1 × `GET /boards/:id/lists` + 1 × `GET /lists/:id/cards`  |
| `getCapabilities()`         | (no I/O — static)                                         |

## What this iteration does NOT add

`removeAtoms(N)` does N parallel `DELETE` calls — Trello's REST API
has no bulk-delete endpoint. **Not a new atomic-multi-write
mechanism.** Same honest framing as Solid Pod (iter 34), ClickHouse
(iter 37), and a few others — the novelty here is in the `pos`
ordering, query-string auth, soft-delete semantics, and
2-level-flattening, not in multi-write atomicity.

## Auth

Provision an API key at
[trello.com/app-key](https://trello.com/app-key); the page issues a
long-lived OAuth 1.0a token via "Allow this token to be used by
this application?" Both go into `TrelloDataSource.auth`:

```ts
new TrelloDataSource({
  boardId,
  auth: { apiKey: '...', token: '...' },
});
```

For production multi-user setups, use the Trello OAuth 1.0a flow to
issue per-user tokens. The data source treats both apiKey and token
as opaque strings — the OAuth handshake is the caller's
responsibility.

## Caveats

- **Card `desc` is capped at 16,384 characters.** Larger content
  needs Trello attachments (file uploads), which this package
  doesn't expose. For CMS workloads with small Markdown documents
  the cap is fine; for larger payloads, use a different backend or
  layer attachment handling on top.
- **List names are global to the board.** Two folders with the same
  name can't coexist. The repository assumes path uniqueness.
- **Soft-delete via `closed`.** Archived lists / cards still exist
  on the Trello board; they just don't appear in `?filter=open`
  listings. Hard-delete is only available for cards via
  `DELETE /1/cards/:id`.
- **Rate limits.** Trello caps at 300 requests per 10 seconds per
  API key, plus 100 per 10 seconds per token. The repository
  doesn't backoff — wrap the `fetch` impl if you need per-request
  pacing.
- **Listing involves N+1 calls.** Listing a folder fetches the
  containing list, then its cards — two HTTP requests minimum.
  Caching at the application layer is the right escape hatch for
  read-heavy workloads.
