# `@laikacms/airtable`

An [Airtable](https://airtable.com)-backed `StorageRepository` for Laika CMS. Many small teams already use Airtable as a database; this gives Laika a first-class authoring surface on top of it.

Runtime-agnostic — only depends on `fetch`.

## `@laikacms/airtable/storage-airtable`

```ts
import { AirtableStorageRepository } from '@laikacms/airtable/storage-airtable';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

const repo = new AirtableStorageRepository({
  baseId:    'appXXXXXXXXXXXX',
  tableName: 'laika_storage',         // OR a table id (`tblYYYYYYYYYYYY`)
  auth: { token: process.env.AIRTABLE_PAT! },
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});
```

### Required table schema

Provision once in the Airtable UI:

| Field | Type | Notes |
|---|---|---|
| `Parent` | Single line text | parent folder path (empty for root) |
| `Name` | Single line text | basename — carries the extension for files |
| `Path` | Single line text | full storage key |
| `Type` | Single select | values: `file`, `folder` |
| `Extension` | Single line text | files only |
| `Content` | Long text | files only — the serialized content |

The repository never touches the schema — provision the table and field set before pointing the repository at it.

### Two Airtable quirks the repository papers over

#### 1. `filterByFormula` is Airtable's DSL

Field names go in `{Braces}`, string literals in `"double quotes"` with embedded `"` doubled (no backslash escaping). The exported `escapeAirtableString` helper handles the quoting:

```ts
import { escapeAirtableString } from '@laikacms/airtable/storage-airtable';

escapeAirtableString('he said "hi"');
// → "he said \"\"hi\"\""    (a 14-char literal that Airtable will read back as: he said "hi")
```

The repository emits formulas like:

```
AND({Type} = "file", {Parent} = "notes", OR({Name} = "hello.md", {Name} = "hello.json"))
```

The test mock ships a recursive-descent parser for this formula subset so the exact query shapes the repository emits get evaluated against the in-memory store the same way Airtable would evaluate them. New formula patterns surface as parser failures rather than silent regressions.

#### 2. Batch endpoints cap at 10 records

`POST` / `PATCH` / `DELETE` on Airtable's `/v0/{baseId}/{table}` all reject more than **10 records per call** with HTTP 422. The data source chunks larger batches transparently:

```
removeAtoms(['k1', …, 'k25'])
  → 1 list query per key for resolution
  → ⌈25 / 10⌉ = 3 DELETE calls (10 + 10 + 5)
```

The "batch chunking" test seeds 25 records, runs one `removeAtoms` over all of them, and asserts exactly 3 DELETE calls fire. See `AIRTABLE_BATCH_LIMIT` for the constant.

### How operations map

| Operation | Airtable call |
|---|---|
| `getObject('hello')` | one list — `filterByFormula=AND({Type}="file", {Parent}="", OR(…names…))` |
| `getFolder('notes')` | one list — `filterByFormula=AND({Type}="folder", {Path}="notes")` |
| `listAtomSummaries('notes')` | one list — `filterByFormula={Parent}="notes"` |
| `createObject` | one POST `/records` per file + one per missing ancestor folder |
| `updateObject` | one PATCH `/records` |
| `removeAtoms(N keys)` | resolve via list per key + `⌈N/10⌉` DELETE calls |
| `createFolder` | one POST per missing ancestor in the chain |

### Trade-offs

- **No OCC.** Airtable doesn't expose a per-record version field that supports `If-Match`. `metadata.revisionId` carries `createdTime` for observability.
- **Filter-formula evaluation is server-side.** Airtable parses and evaluates the formula on each request — there's no precompiled view here.
- **Schema lock-in.** The repository assumes the documented field names exist. If you want different names, fork the package or add a field-name configuration option.
- **Rate limits.** Airtable's free tier caps at 5 requests/sec per base. The data source doesn't currently throttle; surface `TooManyRequestsError` and back off at the caller.

### Errors

| HTTP | Laika error |
|---|---|
| 401 | `AuthenticationError` |
| 403 | `ForbiddenError` |
| 404 | `NotFoundError` |
| 422 | `InternalError` (with the upstream message) |
| 429 | `TooManyRequestsError` |
| 5xx | `ServiceUnavailableError` |
