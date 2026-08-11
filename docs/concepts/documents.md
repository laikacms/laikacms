# Documents

The documents protocol is [storage](./storage) plus editorial behavior: a document has a **status**
(draft, published, …) and a **language**, and its lifecycle (create, update, publish, revisions) is
part of the contract. Use it for pages, posts, and anything an editor works on; use raw storage for
everything else.

## The minimal document

A Markdown file, parsed into body, frontmatter, and document metadata:

```typescript
{
  key: 'hailey-says-hi.md',
  body: '# Hailey says hi!\n\nA photo of Hailey jumping in the garden.',
  status: 'published',
  language: 'en-GB',
}
```

The language can be any BCP 47 tag. Applications without a language concept default to `und`
(undetermined); applications without workflow expose a constant `published` status. The contract
requires only the metadata needed for document behavior — everything else stays your own.

## Documents on top of storage

You rarely implement the documents contract directly. `CatalogDocumentsRepository` implements it on
top of _any_ storage repository, using the [Catalog](./catalog) to know which folders hold which
collections:

```typescript
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';
import { CatalogDocumentsRepository } from 'laikacms/documents-catalog';

const settings = new ConventionCatalogProvider({ storage });
const documents = new CatalogDocumentsRepository(storage, settings);
```

Swap the storage backend and the documents layer follows. Direct implementations exist too —
`documents-drizzle` (SQL), `documents-obsidian` (Obsidian vault), and `documents-jsonapi-proxy` (a
remote LaikaCMS API) — for sources that are natively document-shaped.

::: tip `language` in stored content `CatalogDocumentsRepository` co-locates the document language
with its content in storage, so stored files include a `language` key alongside your fields. Treat
it as a LaikaCMS-managed field: don't declare it in your CMS schema, and filter it out when reading
files directly. :::

## Going deeper

- [Documents API reference](../reference/json-api/documents) — the protocol over HTTP, including
  batch operation semantics
- [Catalog](./catalog) — how collections map to storage folders
