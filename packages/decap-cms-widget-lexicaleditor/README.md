# decap-cms-widget-lexicaleditor

Lexical-based rich text widget for Decap CMS, built on a shadcn-editor fork. Stores content as
Portable Text (via `decap-cms-lexical-core`) and renders a full-featured editor toolbar in the Decap
CMS control panel.

> **Note:** This package was moved out of the `laikacms/laikacms` monorepo in June 2026 into its own
> repository. The npm package name is unchanged. See
> [docs/restructure-2026-06.md](https://github.com/laikacms/laikacms/blob/develop/docs/restructure-2026-06.md)
> for background.

## Install

```bash
pnpm add decap-cms-widget-lexicaleditor decap-cms-lexical-core
# or
npm install decap-cms-widget-lexicaleditor decap-cms-lexical-core
```

## Register with Decap CMS

```ts
import CMS from 'decap-cms-app';
import { Widget } from 'decap-cms-widget-lexicaleditor';

CMS.registerWidget(Widget);
```

Then add the widget to your Decap CMS config:

```yaml
collections:
  - name: posts
    label: Posts
    folder: content/posts
    fields:
      - name: title
        widget: string
      - name: body
        widget: lexicaleditor
```

## Main exports

| Export                      | Description                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `Widget`                    | Decap CMS widget definition — pass to `CMS.registerWidget()`         |
| `LexicalControl`            | React control component (rendered in the Decap CMS editor panel)     |
| `LexicalPreview`            | React preview component (rendered in the Decap CMS preview panel)    |
| `lexicalEditorWidgetSchema` | Zod schema for the widget field configuration                        |
| `passthroughSerializer`     | Serializer that stores the Portable Text value as-is                 |
| `Editor`                    | The standalone Lexical editor React component (usable outside Decap) |

## Standalone editor usage

The `Editor` component can be used independently of Decap CMS:

```tsx
import { LexicalRichtextValue } from 'decap-cms-lexical-core';
import { Editor } from 'decap-cms-widget-lexicaleditor';

function MyPage() {
  const [value, setValue] = React.useState<LexicalRichtextValue | null>(null);
  return <Editor value={value} onChange={setValue} />;
}
```

## Peer dependencies

| Package     | Version |
| ----------- | ------- |
| `react`     | `>=19`  |
| `react-dom` | `>=19`  |

## License

MIT
