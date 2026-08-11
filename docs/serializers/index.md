# Serializers

A serializer decides how a content object becomes text on the wire or on disk — and back. It is a
separate axis from [backends](../backends/fs): **any backend × any serializer**. Markdown files can
live in S3; JSON can live in git; nothing couples a format to a storage location.

Repositories take a **serializer registry** mapping file extensions to serializers, plus a default
extension for newly created objects:

```ts
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

const serializerRegistry = {
  json: jsonSerializer,
  md: markdownSerializer,
  yaml: yamlSerializer,
  yml: yamlSerializer,
};

const storage = new FileSystemStorageRepository('./content', serializerRegistry, 'md');
```

The extension picks the serializer per object, so one repository can hold `posts/hello.md`,
`settings/site.yaml`, and `data/products.json` side by side.

Four serializers ship with `laikacms`:

| Serializer                              | Format                    | Page                   |
| --------------------------------------- | ------------------------- | ---------------------- |
| `laikacms/storage-serializers-json`     | JSON                      | [JSON](./json)         |
| `laikacms/storage-serializers-markdown` | Markdown with frontmatter | [Markdown](./markdown) |
| `laikacms/storage-serializers-yaml`     | YAML                      | [YAML](./yaml)         |
| `laikacms/storage-serializers-raw`      | Plain text                | [Raw](./raw)           |

Need another format? The interface is two async functions — [write your own](./custom).
