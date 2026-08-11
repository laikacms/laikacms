# Markdown

`markdownSerializer` (`laikacms/storage-serializers-markdown`) writes the
[`body` convention](../concepts/storage#the-body-convention) as a Markdown file: the `body` field
becomes the document body, every other field becomes YAML frontmatter.

```ts
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

const storage = new FileSystemStorageRepository('./content', { md: markdownSerializer }, 'md');
```

The object `{ title: 'Hello', tags: ['intro'], body: '# Hello\n\nMy first post.' }` becomes:

```markdown
---
title: Hello
tags:
  - intro
---

# Hello

My first post.
```

Deserializing reverses it exactly: frontmatter fields sit alongside `body` in the content object.

## When to choose it

- The files stay first-class Markdown — readable in GitHub, editable in Obsidian, renderable by any
  static site generator. This is the serializer that makes a git repo or an
  [Obsidian vault](../backends/obsidian) feel native.
- Content without a `body` still works (it's all frontmatter), but if the shape is purely structured
  data, [YAML](./yaml) says so more honestly.
