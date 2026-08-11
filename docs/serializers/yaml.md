# YAML

`yamlSerializer` (`laikacms/storage-serializers-yaml`) stores the whole content object as a YAML
document — the human-editable format for structured records (settings, product data, anything an
editor might open in a text editor without wanting JSON's punctuation).

```ts
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

const storage = new FileSystemStorageRepository(
  './content',
  { yaml: yamlSerializer, yml: yamlSerializer }, // register both extensions
  'yaml',
);
```

The object `{ name: 'Hailey', age: 11, colors: ['white', 'brown', 'black'] }` becomes:

```yaml
name: Hailey
age: 11
colors:
  - white
  - brown
  - black
```

## When to choose it

- Structured records that humans read and edit directly.
- Parsing uses YAML's JSON schema (no custom tags, no reference expansion), so round-trips stay
  predictable and content stays portable to any YAML consumer.
