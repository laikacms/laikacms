# decap-cms-widget-portabletext-editor

Decap CMS widget backed by `@portabletext/editor` (Sanity's native Portable Text editor). A sibling
of `decap-cms-widget-lexicaleditor` — choose this when you want the official Portable Text editing
experience instead of the Lexical-based editor.

> **Note:** This package was moved out of the `laikacms/laikacms` monorepo in June 2026 into its own
> repository. The npm package name is unchanged. See
> [docs/restructure-2026-06.md](https://github.com/laikacms/laikacms/blob/develop/docs/restructure-2026-06.md)
> for background.

## Install

```bash
pnpm add decap-cms-widget-portabletext-editor
# or
npm install decap-cms-widget-portabletext-editor
```

## Register with Decap CMS

```ts
import CMS from 'decap-cms-app';
import { Widget } from 'decap-cms-widget-portabletext-editor';

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
        widget: portabletext-editor
```

## Main exports

| Export                      | Description                                                                |
| --------------------------- | -------------------------------------------------------------------------- |
| `Widget`                    | Decap CMS widget definition — pass to `CMS.registerWidget()`               |
| `PortableTextEditorControl` | React control component (rendered in the Decap CMS editor panel)           |
| `PortableTextEditorPreview` | React preview component (rendered in the Decap CMS preview panel)          |
| `PortableTextEditorView`    | The standalone Portable Text editor React component (usable outside Decap) |
| `schema`                    | Default `@portabletext/editor` schema used by the widget                   |

## Standalone editor usage

The `PortableTextEditorView` component can be used independently of Decap CMS:

```tsx
import { PortableTextEditorView } from 'decap-cms-widget-portabletext-editor';

function MyPage() {
  const [value, setValue] = React.useState(null);
  return <PortableTextEditorView value={value} onChange={setValue} />;
}
```

## Peer dependencies

| Package     | Version |
| ----------- | ------- |
| `react`     | `>=19`  |
| `react-dom` | `>=19`  |

## License

MIT
