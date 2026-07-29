# Content Model

This page explains the vocabulary the LaikaCMS protocol imposes on your content — and, just as
importantly, what it _doesn't_. For the exact, load-bearing definitions of each term, see the
[Glossary](../reference/glossary).

## Atoms and folders

The storage domain speaks in **atoms**. An atom is either a **storage object** (a leaf holding your
content) or a **folder** (a grouping). Keys are arbitrary path-like strings such as
`posts/hello-world`; folders come from the slashes in those keys. These wrappers carry your content
— they are not a data model imposed on it.

## The `content` object is yours

The protocol knows only atoms, folders, keys, metadata, and summaries. The `content` field on an
object is your own arbitrary JSON and is **never interpreted** by the protocol. That is what lets
the same core drive a blog, a product catalogue, or a settings store without changes — "Laika minus
the CMS is basically a protocol."

## The `body` convention

Content in laikacms is always an object — you cannot store a raw string directly. When all you have
is a raw string (plain text, markdown, HTML, …), the convention is to wrap it in a `body` field:

```json
{ "body": "<content>" }
```

Markdown with frontmatter follows the same shape — frontmatter fields sit alongside `body`:

```json
{ "title": "Hello", "tags": ["intro"], "body": "# Hello\n\nMy first post." }
```

This is just a convention: the protocol itself never interprets the `content` object. Serializers,
however, build on it — `rawSerializer` persists exactly the `body` field as plain text, and the
markdown serializer writes `body` as the document body with the remaining fields as frontmatter.

## Change primitives: version, sync token, change feed

Three optional, capability-gated primitives let clients track what changed without re-reading
everything. They are all **opaque** — comparable only by equality, never parsed:

- **version** — a per-record change token, exposed as the optional `version` field. It changes if
  and only if a record's content changed. A git blob sha, a database row version, and an R2 ETag are
  all valid implementations.
- **sync token** — a per-scope change token from `getSyncToken(options?)`. One token covers one
  scope (a folder, or the whole store). It changes whenever anything inside that scope changes — a
  cheap "did anything change?" polling primitive.
- **change feed** — the `listChanges({ since, folder? })` stream, which enumerates what changed
  inside a scope since a previously obtained sync token. Its done value carries the new sync token
  to resume from.

Each is gated behind `getCapabilities()` (`versionTracking`, `changes.syncToken`,
`changes.changeFeed`) — not every backend supports them. See the [Glossary](../reference/glossary)
for the precise contracts.
