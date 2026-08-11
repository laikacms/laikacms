# JSON

`jsonSerializer` (`laikacms/storage-serializers-json`) stores content objects as pretty-printed
JSON. It is the most literal serializer: the file _is_ the content object, nothing added, nothing
interpreted.

```ts
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
```

An object `{ title: 'Hello', body: '# Hi' }` under key `posts/hello` becomes `posts/hello.json`:

```json
{
  "title": "Hello",
  "body": "# Hi"
}
```

## When to choose it

- The safest default: round-trips every content shape without conventions or loss.
- Required today for Decap-edited collections — the Decap backend currently persists structured
  content only for `format: json` collections (see [Decap → Configuration](../decap/configuration)).
- Prefer [Markdown](./markdown) when humans edit the files directly and the content is prose; prefer
  [YAML](./yaml) when humans edit structured records.
