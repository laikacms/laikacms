# JSON:API Reference

LaikaCMS exposes its content over HTTP as [JSON:API v1.1](https://jsonapi.org/) servers. This
section documents every endpoint, grouped by API server.

- [Storage API](./storage) — low-level key/value atom and folder storage
- [Documents API](./documents) — versioned content with a publish/unpublish lifecycle
- [Assets API](./assets) — binary file and folder management
- [ContentBase API](./contentbase) — collection settings
- [Error Responses](./errors) — shared error format and codes

## Overview

LaikaCMS exposes three HTTP API servers, each following the [JSON:API v1.1](https://jsonapi.org/)
specification. All responses use the `application/vnd.api+json` content type.

| Server          | Default Base Path | Purpose                                            |
| --------------- | ----------------- | -------------------------------------------------- |
| Storage API     | configurable      | Low-level key/value atom and folder storage        |
| Documents API   | configurable      | Versioned content with publish/unpublish lifecycle |
| Assets API      | `/api/assets`     | Binary file and folder management                  |
| ContentBase API | configurable      | Collection settings (document and media folders)   |

### JSON:API Conventions

- Single resources are returned as `{ "data": { ... } }`.
- Collections are returned as `{ "data": [ ... ], "links": { ... }, "meta": { "page": { ... } } }`.
- Errors are returned as `{ "errors": [ { "status", "code", "detail" } ] }`.
- The Documents API `/operations` endpoint is a **fail-fast batch** (not a JSON:API Atomic
  Operations extension): request body is `{ "operations": [ ... ] }`, response is
  `{ "results": [ ... ] }`. Pre-flight validates all ops before any I/O; a shape-invalid batch
  returns 400 with zero writes. A mid-batch repository failure stops processing but does not roll
  back prior ops.
- Cursor-based pagination is controlled with `page[after]` (forward) / `page[before]` (backward) and
  `page[size]` query parameters. Offset-based pagination uses `page[offset]` and `page[limit]`.
  **Cursor pagination is backend-specific.** Not all storage backends support `page[after]` /
  `page[before]`; backends like `FileSystemStorageRepository` and `R2StorageRepository` only support
  offset- and page-based pagination. Sending a cursor param to an unsupported backend returns a
  `400 Bad Request` with a `invalid_data` error. Inspect `GET /capabilities`
  (`attributes.pagination.styles.cursor`) to confirm cursor support before using these params.
