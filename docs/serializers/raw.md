# Raw

`rawSerializer` (`laikacms/storage-serializers-raw`) persists exactly the
[`body`](../concepts/storage#the-body-convention) field as plain text — nothing else. The file is
the string; deserializing wraps it back into `{ body: raw }`.

```ts
import { rawSerializer } from 'laikacms/storage-serializers-raw';

const storage = new FileSystemStorageRepository('./content', { txt: rawSerializer }, 'txt');
```

`{ body: 'robots: welcome' }` under key `robots.txt` is a file containing literally
`robots: welcome`.

## Fail-fast on extra fields

Serializing content with any field besides `body` **throws** rather than silently dropping data:

```
rawSerializer only persists the 'body' field; fields [title] would be silently
dropped. Use jsonSerializer to store multi-field content.
```

This is deliberate — a lossy write you didn't notice is worse than an error you did.

## When to choose it

- Files that are their own format: `robots.txt`, `.htaccess`, HTML fragments, SVG.
- Anything where another tool owns the file format and LaikaCMS just moves it around.
