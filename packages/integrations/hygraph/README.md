# `@laikacms/hygraph`

A [Hygraph](https://hygraph.com) (formerly GraphCMS) -backed `StorageRepository` via the GraphQL
Content API. **The first true-GraphQL transport in the suite** — Sanity (`@laikacms/sanity`) uses
GROQ, which is its own syntax; this one talks standard GraphQL.

Runtime-agnostic — only depends on `fetch`.

## `@laikacms/hygraph/storage-hygraph`

```ts
import { HygraphStorageRepository } from '@laikacms/hygraph/storage-hygraph';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

const repo = new HygraphStorageRepository({
  endpoint: 'https://api-eu-west-2.hygraph.com/v2/<project-id>/master',
  auth: {
    token: process.env.HYGRAPH_PAT!,
    // or: tokenProvider: () => refreshedPat(),
  },
  stage: 'DRAFT', // optional — defaults to "DRAFT"
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});
```

### Required content models (provision via Hygraph Studio)

```
model LaikaObject {
  parent     String
  name       String
  path       String
  extension  String
  content    String      # long-text / multi-line
}

model LaikaFolder {
  parent  String
  name    String
  path    String
}
```

The repository never modifies the schema — provision both models in your Hygraph project before
pointing the repository at it. Without them, queries fail with `Cannot query field …` GraphQL errors
that surface as `InternalError`.

### How operations map to GraphQL

| Operation                    | GraphQL op                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `getObject('hello')`         | `query FindLaikaObject` — `where: { parent: "", name_in: [...] }`                                                    |
| `getFolder('notes')`         | `query GetLaikaFolder` — `where: { path: "notes" }`                                                                  |
| `listAtomSummaries('notes')` | `query ListLaikaChildren` — fetches **both** `laikaObjects` and `laikaFolders` filtered by parent in **one** request |
| `createObject`               | `mutation CreateLaikaObject` + one `CreateLaikaFolder` per missing ancestor                                          |
| `updateObject`               | `mutation UpdateLaikaObject`                                                                                         |
| `removeAtoms`                | `mutation DeleteLaikaObject` / `DeleteLaikaFolder`                                                                   |

### The cleverest bit — one query returns both files and folders

Every previous backend in the suite either issued two separate operations (Sanity, Cloudinary) or
relied on the storage's native delimiter/prefix semantics to mix files + folders in one response.
GraphQL lets the repository ask for **two top-level fields in one operation**:

```graphql
query ListLaikaChildren($parent: String!, $stage: Stage!) {
  laikaObjects(where: { parent: $parent }, stage: $stage) { ... }
  laikaFolders(where: { parent: $parent }, stage: $stage) { ... }
}
```

The test mock dispatches on `operationName` and verifies exactly **one** `ListLaikaChildren` call
fires when `listAtomSummaries` runs.

### Stage handling

Hygraph splits content into stages (typically `DRAFT` and `PUBLISHED`). The repository reads/writes
the configured `stage` (default `DRAFT`). To auto-publish writes, set `stage: 'PUBLISHED'` — note
that Hygraph's `publish*` mutations exist for forwarding DRAFT → PUBLISHED, but this repository
doesn't currently fire them. If you want publish workflow, layer that above.

### Errors

| HTTP / GraphQL         | Laika error                                       |
| ---------------------- | ------------------------------------------------- |
| 401                    | `AuthenticationError`                             |
| 403                    | `ForbiddenError`                                  |
| 404                    | `NotFoundError`                                   |
| 429                    | `TooManyRequestsError`                            |
| 5xx                    | `ServiceUnavailableError`                         |
| GraphQL `errors` (200) | `InternalError` with the upstream messages joined |

### Trade-offs

- **Schema lock-in.** This repository assumes `LaikaObject` + `LaikaFolder` exist with the
  documented fields. Real Hygraph projects have many other models; this approach lives alongside
  them but doesn't introspect.
- **No OCC.** Hygraph's GraphQL mutations don't expose a per-document revision-id parameter the way
  Sanity / Contentful do. `metadata.revisionId` carries `updatedAt` for observability but isn't
  enforced on write.
- **Operation name is mandatory.** The data source always sends `operationName` so server-side
  logging and the test mock both have a clean dispatch key.
