# decap-cms-lexical-core

Lexical-specific bindings for the editor-agnostic `@laikacloud/portabletext-core`: Portable Text ↔
Lexical bridge, headless editor factory, custom blocks subsystem, and the `LexicalRichtextValue`
class that derives canonical Portable Text from a Lexical editor state on every change.

> **Note:** This package was moved out of the `laikacms/laikacms` monorepo in June 2026 into its own
> repository. The npm package name is unchanged. See
> [docs/restructure-2026-06.md](https://github.com/laikacms/laikacms/blob/develop/docs/restructure-2026-06.md)
> for background.

## Install

```bash
pnpm add decap-cms-lexical-core
# or
npm install decap-cms-lexical-core
```

## Main exports

| Export                                              | Description                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `LexicalRichtextValue`                              | `RichtextValue` subclass that owns a Lexical `EditorState` and produces Portable Text |
| `createHeadlessEditor()`                            | Creates a Lexical headless editor with the standard node set pre-registered           |
| `defaultNodes`                                      | Array of Lexical `EditorNode` constructors for the standard headless editor           |
| `lexicalToPortableText(editorState)`                | Convert a Lexical `EditorState` to a `PortableTextDocument`                           |
| `portableTextToLexical(doc, editor)`                | Populate a Lexical editor from a `PortableTextDocument`                               |
| `emptyPortableText()`                               | Returns a minimal valid empty `PortableTextDocument`                                  |
| `BlockNode` / `blocksContext`                       | Custom block subsystem for embedding arbitrary Decap entries inside Lexical           |
| _(everything from `@laikacloud/portabletext-core`)_ | Re-exported for convenience: `Mapper`, `RichtextValue`, `createKeyGenerator`, …       |

## Basic usage

```ts
import {
  createHeadlessEditor,
  emptyPortableText,
  lexicalToPortableText,
  portableTextToLexical,
} from 'decap-cms-lexical-core';

// Create a headless Lexical editor (e.g. for server-side serialization)
const editor = createHeadlessEditor();

// Populate from stored Portable Text
const stored = JSON.parse(rawJson); // your stored PortableTextDocument
portableTextToLexical(stored, editor);

// Read back as Portable Text
const doc = lexicalToPortableText(editor.getEditorState());
```

## Peer dependencies

| Package   | Version   |
| --------- | --------- |
| `react`   | `>=19`    |
| `lexical` | `^0.42.0` |

## License

MIT
