# Content Model

This page explains the vocabulary the LaikaCMS protocol imposes on your content — and, just as
importantly, what it _doesn't_. For the exact, load-bearing definitions of each term, see the
[Glossary](../reference/glossary).

## Atoms and folders

The storage domain speaks in **atoms**. An atom is either a **storage object** (a leaf holding your
content) or a **folder** (a grouping). Keys are arbitrary path-like strings such as
`posts/hello-world`; folders come from the slashes in those keys. These wrappers carry your content
— they are not a data model imposed on it.

### Keys

A key is the unique address of an object, such as `src/blog/hello-world.md` or
`94c3f782-cf80-44c7-a9d3-79a49a367dbe`. It is called a key rather than an ID because filenames and
other path-like values are valid addresses too. A database ID is a valid key, while a filename is
not normally called an ID even though it can address an object. Slashes form folder boundaries; the
remaining key format belongs to the repository and its data model. There is deliberately no global
set of allowed characters: a valid key depends on the source's data model.

## The `content` object is yours

The protocol knows only atoms, folders, keys, metadata, and summaries. The `content` field on an
object is your own arbitrary JSON and is **never interpreted** by the protocol. That is what lets
the same core drive a blog, a product catalogue, or a settings store without changes — "Laika minus
the CMS is basically a protocol."

The contracts make no assumptions about the shape of application entities and do not force a Laika
CMS field set onto them. The storage contract is the simplest: it needs a key and content, and makes
no assumptions about application metadata. More specialized contracts require only the metadata
needed for their behavior.

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

A collection of Markdown files passes through the storage protocol as one keyed content object per
file, for example:

```json
{ "key": "my-markdown.md", "content": { "body": "# My markdown\n\nHello World!" } }
```

This is just a convention: the protocol itself never interprets the `content` object. Serializers,
however, build on it — `rawSerializer` persists exactly the `body` field as plain text, and the
markdown serializer writes `body` as the document body with the remaining fields as frontmatter.

Keeping content inside an object leaves room to add fields without changing the surrounding
protocol. This is why content cannot be encoded as a bare primitive. A number cannot later gain
metadata without changing its type; `{ "temperatureDegrees": 24 }` can gain fields without breaking
the contract. This restriction also prevents easy-to-miss integration mistakes. Structured values
retain their natural fields:

```json
{ "temperatureDegrees": 24 }
```

## Mapping an application onto Laika CMS

Suppose an application contains cats, pages about cats, and cat images. Their infrastructure might
be YAML records, Markdown files, and images stored on GitHub:

- cats live in files such as `cat-hailey.yaml` and `cat-luna.yaml`;
- pages live in files such as `what-hailey-did-today.md` and `crazy-luna.md`;
- assets live in files such as `hailey.png` and `luna.png`.

Each concept maps to the narrowest suitable contract:

- `Cat` uses the storage contract for raw cat data;
- `PageAboutCat` uses the document contract for page metadata such as title, description, and
  `publishedAt`;
- `CatImage` uses the asset contract for a direct link, binary metadata, and variants for different
  screen sizes;
- settings use the settings contract.

The original entities remain application-owned. A cat can stay
`{ name: 'Hailey', age: 11, colors: ['white', 'brown', 'black'] }`; Laika CMS only wraps it with the
addressing and repository behavior required to transport it.

A Markdown file is parsed into body, frontmatter, and document metadata. For example:

```typescript
{
  key: 'hailey-says-hi.md',
  body: '# Hailey says hi!\n\nA photo of Hailey jumping in the garden: ![img](./uploads/hailey-garden.jpg)',
  status: 'published',
  language: 'en-GB',
}
```

The language can be any applicable BCP 47 tag, such as `en` or `en-GB`.

Asset content embeds a key rather than a deployment-specific URL. A consumer can request the asset
URL or a resized variation, and the repository resolves it across domains, on localhost, through a
CDN, as a signed URL, or with the required query parameters. In a simple setup where URLs are always
relative, such as `/uploads/image1.png`, the key and URL can be identical. The repository returns
the key immediately, so the abstraction adds no unnecessary overhead when the URL can be inferred
from the key alone.

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
