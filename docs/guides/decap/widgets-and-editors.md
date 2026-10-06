# Widgets & Editor Components

## Widgets

> **Version requirement:** the widget subpaths (`/widgets/lucide-icon`, `/widgets/radix-icon`,
> `/widgets/aichat`) ship in `@laikacms/decap-cms@alpha` (≥ 4.1.0-alpha.5). They are **not** present
> in `@laikacms/decap-cms@latest` (4.0.4-alpha.3). Install the alpha tag explicitly:
>
> ```bash
> npm install @laikacms/decap-cms@alpha
> # or
> pnpm add @laikacms/decap-cms@alpha
> ```

| Widget       | Subpath                                   |
| ------------ | ----------------------------------------- |
| AI Chat      | `@laikacms/decap-cms/widgets/aichat`      |
| Lucide Icons | `@laikacms/decap-cms/widgets/lucide-icon` |
| Radix Icons  | `@laikacms/decap-cms/widgets/radix-icon`  |

Each widget registers under a unique name (`lucide-icon` / `radix-icon`) so both can be used in the
same app without one overwriting the other.

```ts
import { DecapCmsApp as CMS } from '@laikacms/decap-cms';
import LucideWidgetIcon from '@laikacms/decap-cms/widgets/lucide-icon';
import RadixWidgetIcon from '@laikacms/decap-cms/widgets/radix-icon';

// Registers as 'lucide-icon'
CMS.registerWidget(LucideWidgetIcon.Widget());

// Registers as 'radix-icon' — safe to call alongside lucide-icon
CMS.registerWidget(RadixWidgetIcon.Widget());
```

> **Root import:** `import { DecapCmsApp as CMS } from '@laikacms/decap-cms'` (consistent with
> [quickstart-fs.md](./quickstart-fs) and [admin-shell.md](./admin-shell)) — the root export has no
> default export; `DecapCmsApp` is the classic `CMS`-shaped object (`registerWidget`,
> `registerBackend`, `init`, …). It bundles cleanly for the browser with esbuild.

In collection config, reference them by their distinct names:

```yaml
fields:
  - label: Button Icon   # uses Lucide picker
    name: button_icon
    widget: lucide-icon
  - label: Feature Icon  # uses Radix picker
    name: feature_icon
    widget: radix-icon
```

## Rich text editors

Two rich text widgets store content as [Portable Text](https://portabletext.org), so the stored
value is portable JSON rather than editor-specific HTML. Pick one.

### Lexical editor

A full-featured toolbar editor built on [Lexical](https://lexical.dev).

```bash
pnpm add decap-cms-widget-lexicaleditor decap-cms-lexical-core
```

```ts
import { DecapCmsApp as CMS } from '@laikacms/decap-cms';
import { Widget } from 'decap-cms-widget-lexicaleditor';

CMS.registerWidget(Widget);
```

```yaml
fields:
  - name: body
    widget: lexicaleditor
```

| Export                  | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `Widget`                | Widget definition object; pass to `CMS.registerWidget()`             |
| `LexicalControl`        | React control component (the editor panel)                           |
| `LexicalPreview`        | React preview component (the preview panel)                          |
| `passthroughSerializer` | Serializer that stores the Portable Text value as-is (no conversion) |
| `Editor`                | The standalone Lexical editor React component (usable outside Decap) |

`decap-cms-lexical-core` holds the editor-independent parts, for using the same Portable Text
conversion outside the widget:

| Export                        | Description                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `LexicalRichtextValue`        | `RichtextValue` subclass that owns a Lexical `EditorState` and produces Portable Text |
| `createHeadlessEditor()`      | Creates a Lexical headless editor with the standard node set pre-registered           |
| `lexicalToPortableText()`     | Convert a Lexical `EditorState` to a `PortableTextDocument`                           |
| `portableTextToLexical()`     | Populate a Lexical editor from a `PortableTextDocument`                               |
| `emptyPortableText()`         | Returns a minimal valid empty `PortableTextDocument`                                  |
| `BlockNode` / `blocksContext` | Custom blocks for embedding other entries inside the editor                           |

### Portable Text editor

Backed by [`@portabletext/editor`](https://www.portabletext.org/), Sanity's native Portable Text
editor. Choose this one for the official Portable Text editing experience instead of Lexical.

```bash
pnpm add decap-cms-widget-portabletext-editor
```

```ts
import { DecapCmsApp as CMS } from '@laikacms/decap-cms';
import { Widget } from 'decap-cms-widget-portabletext-editor';

CMS.registerWidget(Widget);
```

```yaml
fields:
  - name: body
    widget: portabletext-editor
```

| Export                      | Description                                                                |
| --------------------------- | -------------------------------------------------------------------------- |
| `Widget`                    | Widget definition object; pass to `CMS.registerWidget()`                   |
| `PortableTextEditorControl` | React control component (the editor panel)                                 |
| `PortableTextEditorPreview` | React preview component (the preview panel)                                |
| `PortableTextEditorView`    | The standalone Portable Text editor React component (usable outside Decap) |
| `schema`                    | Default `@portabletext/editor` schema used by the widget                   |
