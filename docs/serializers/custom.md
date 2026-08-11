# Write your own

A serializer is an object with a format tag and two async functions — that's the whole contract:

```ts
import type { JSONSchema7 } from 'json-schema';
import type { StorageFormat, StorageObjectContent, StorageSerializer } from 'laikacms/storage';

export interface StorageSerializer<F extends StorageFormat> {
  format: F;
  serializeDocumentFileContents(
    content: StorageObjectContent,
    schema: JSONSchema7,
  ): Promise<string>;
  deserializeDocumentFileContents(
    content: string,
    schema: JSONSchema7,
  ): Promise<StorageObjectContent>;
}
```

The `schema` parameter is the collection's JSON Schema from the [Catalog](../concepts/catalog) — the
shipped serializers ignore it, but a custom serializer can use it (for example, to decide which
fields are dates in a TOML document).

## Example: TOML

```ts
import type { JSONSchema7 } from 'json-schema';
import type { StorageFormat, StorageObjectContent, StorageSerializer } from 'laikacms/storage';
import { parse, stringify } from 'smol-toml';

export const tomlSerializer: StorageSerializer<StorageFormat> = {
  format: 'toml' as StorageFormat,
  async serializeDocumentFileContents(content: StorageObjectContent, _schema: JSONSchema7) {
    return stringify(content);
  },
  async deserializeDocumentFileContents(raw: string, _schema: JSONSchema7) {
    return parse(raw) as StorageObjectContent;
  },
};
```

Register it under an extension and every repository that takes a registry can use it:

```ts
const storage = new FileSystemStorageRepository(
  './content',
  { toml: tomlSerializer, json: jsonSerializer },
  'toml',
);
```

## Ground rules

- **Round-trip faithfully.** `deserialize(serialize(content))` must reproduce the content object —
  or throw. Fail fast on shapes your format can't hold (see how the
  [raw serializer](./raw#fail-fast-on-extra-fields) refuses multi-field content) rather than
  dropping fields silently.
- **Content is always an object**, never a bare primitive — if your format is stringly, wrap it in
  [`body`](../concepts/storage#the-body-convention) on the way in.
- Keys don't carry the format; the registry extension does. Register the same serializer under
  several extensions when they're synonyms (`yaml` and `yml`).
