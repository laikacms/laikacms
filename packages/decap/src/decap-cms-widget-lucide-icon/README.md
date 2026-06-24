# `@laikacms/decap/decap-cms-widget-lucide-icon`

An icon-picker widget for [Decap CMS](https://decapcms.org/) that lets editors browse and select
icons from the [Lucide](https://lucide.dev/) icon library.

## Installation

The widget ships as a subpath export of `@laikacms/decap`:

```bash
pnpm add @laikacms/decap
```

## Usage

### Register the widget

Call `CMS.registerWidget` once during Decap CMS initialisation, before the editor mounts:

```ts
import CMS from '@laikacms/decap-cms';
import WidgetIcon from '@laikacms/decap/decap-cms-widget-lucide-icon';

CMS.registerWidget(WidgetIcon.Widget());
```

Pass `IconWidgetOptions` to `Widget()` to restrict the available icons:

```ts
import WidgetIcon from '@laikacms/decap/decap-cms-widget-lucide-icon';
import type { IconWidgetOptions } from '@laikacms/decap/decap-cms-widget-lucide-icon';

const opts: IconWidgetOptions = {
  // Optional: only show icons whose names contain this string (case-insensitive search
  // is handled by the control itself; this filter applies on top at registration time).
  filter: /^Arrow/,
};

CMS.registerWidget(WidgetIcon.Widget(opts));
```

### Decap CMS config

After registration, use `widget: icon` in any collection field:

```yaml
collections:
  - name: pages
    label: Pages
    files:
      - name: home
        label: Home
        file: content/home.md
        fields:
          - label: Icon
            name: icon
            widget: icon
```

The field value stored in your content files is the Lucide icon name as a string (e.g.
`"ArrowRight"`).

### Rendering the icon in your frontend

```tsx
import * as LucideReact from 'lucide-react';

interface Props {
  icon: string; // value from the CMS field
}

export function Icon({ icon }: Props) {
  const LucideIcon = (LucideReact as Record<string, React.ElementType>)[icon];
  if (!LucideIcon) return null;
  return <LucideIcon />;
}
```

## API

### `WidgetIcon` (default export)

| Property           | Type                                      | Description                               |
| ------------------ | ----------------------------------------- | ----------------------------------------- |
| `name`             | `'icon'`                                  | Widget type name used in Decap config     |
| `Widget`           | `(opts?: IconWidgetOptions) => WidgetDef` | Factory — call this for `registerWidget`  |
| `controlComponent` | `React.FC<IconControlProps>`              | The picker control rendered in the editor |
| `previewComponent` | `React.FC`                                | The preview shown alongside the editor    |

### `IconWidgetOptions`

| Property     | Type     | Required | Description                                                       |
| ------------ | -------- | -------- | ----------------------------------------------------------------- |
| `collection` | `string` | no       | Arbitrary collection label (passed through to the widget config)  |
| `filter`     | `RegExp` | no       | Only icons whose names match this pattern are shown in the picker |
