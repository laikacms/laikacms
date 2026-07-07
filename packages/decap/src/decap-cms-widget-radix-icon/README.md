# `@laikacms/decap/decap-cms-widget-radix-icon`

An icon-picker widget for [Decap CMS](https://decapcms.org/) that lets editors browse and select
icons from the [Radix UI Icons](https://www.radix-ui.com/icons) library.

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
import WidgetIcon from '@laikacms/decap/decap-cms-widget-radix-icon';

CMS.registerWidget(WidgetIcon.Widget());
```

Pass `IconWidgetOptions` to `Widget()` to restrict the available icons:

```ts
import WidgetIcon from '@laikacms/decap/decap-cms-widget-radix-icon';
import type { IconWidgetOptions } from '@laikacms/decap/decap-cms-widget-radix-icon';

const opts: IconWidgetOptions = {
  // Optional: only show icons whose names contain this string (case-insensitive search
  // is handled by the control itself; this filter applies on top at registration time).
  filter: /^Arrow/,
};

CMS.registerWidget(WidgetIcon.Widget(opts));
```

### Decap CMS config

After registration, use `widget: radix-icon` in any collection field:

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
            widget: radix-icon
```

> **Note:** This widget registers as `radix-icon`. If you also use
> `@laikacms/decap/decap-cms-widget-lucide-icon` (which registers as `lucide-icon`), both can
> coexist in the same Decap CMS app without one overwriting the other.

The field value stored in your content files is the Radix icon component name as a string (e.g.
`"ArrowRightIcon"`). All Radix icons follow the `<Name>Icon` naming convention.

### Rendering the icon in your frontend

```tsx
import * as RadixIcons from '@radix-ui/react-icons';

interface Props {
  icon: string; // value from the CMS field, e.g. "ArrowRightIcon"
}

export function Icon({ icon }: Props) {
  const RadixIcon = (RadixIcons as Record<string, React.ElementType>)[icon];
  if (!RadixIcon) return null;
  return <RadixIcon />;
}
```

## API

### `WidgetIcon` (default export)

| Property           | Type                                      | Description                               |
| ------------------ | ----------------------------------------- | ----------------------------------------- |
| `name`             | `'radix-icon'`                            | Widget type name used in Decap config     |
| `Widget`           | `(opts?: IconWidgetOptions) => WidgetDef` | Factory — call this for `registerWidget`  |
| `controlComponent` | `React.FC<IconControlProps>`              | The picker control rendered in the editor |
| `previewComponent` | `React.FC`                                | The preview shown alongside the editor    |

### `IconWidgetOptions`

| Property     | Type                                  | Required | Description                                                                               |
| ------------ | ------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `collection` | `string`                              | no       | Arbitrary collection label (passed through to the widget config)                          |
| `filter`     | `RegExp \| ((id: string) => boolean)` | no       | Only icons whose names match this pattern (or pass the predicate) are shown in the picker |
