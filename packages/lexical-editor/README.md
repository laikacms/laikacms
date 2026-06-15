# @laikacms/lexical-editor

A framework-agnostic [Lexical](https://lexical.dev/) rich-text editor, built as an emotion-styled
fork of [htmujahid/shadcn-editor](https://github.com/htmujahid/shadcn-editor), together with a
Portable Text ⇄ Lexical bridge.

It has no dependency on Decap CMS — the Decap widget adapter lives in
`decap-cms-widget-lexicaleditor`, which consumes this package.

## Exports

| Specifier                           | Contents                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@laikacms/lexical-editor`          | The `Editor` component, editor themes, and format-agnostic editor utilities.                                                                                                                                                              |
| `@laikacms/lexical-editor/core`     | Portable Text ⇄ Lexical bridge: PT conversion, the Lexical node set, the headless editor factory, the custom blocks subsystem, and the `LexicalRichtextValue` value type. Re-exports the editor-agnostic `@laikacloud/portabletext-core`. |
| `@laikacms/lexical-editor/editor/*` | Individual editor modules — UI components (`editor/ui/button`), themes (`editor/themes/global-styles`), plugins, nodes, etc.                                                                                                              |

```ts
import { Editor } from '@laikacms/lexical-editor';
import { LexicalRichtextValue, portableTextToLexical } from '@laikacms/lexical-editor/core';
import { Button } from '@laikacms/lexical-editor/editor/ui/button';
```

## Output formats

Output formats are intentionally not bundled. Register the mappers you want at the call site via
`registerMapper(...)` from `@laikacloud/portabletext-core` (re-exported from
`@laikacms/lexical-editor/core`) so consumers only pay for what they use.
