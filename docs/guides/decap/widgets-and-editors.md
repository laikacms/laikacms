# Widgets & Editor Components

## Widgets

| Widget       | Subpath                                   |
| ------------ | ----------------------------------------- |
| AI Chat      | `@laikacms/decap-cms/widgets/aichat`      |
| Lucide Icons | `@laikacms/decap-cms/widgets/lucide-icon` |
| Radix Icons  | `@laikacms/decap-cms/widgets/radix-icon`  |

Each widget registers under a unique name (`lucide-icon` / `radix-icon`) so both can be used in the
same app without one overwriting the other.

```ts
import CMS from '@laikacms/decap-cms';
import LucideWidgetIcon from '@laikacms/decap-cms/widgets/lucide-icon';
import RadixWidgetIcon from '@laikacms/decap-cms/widgets/radix-icon';

// Registers as 'lucide-icon'
CMS.registerWidget(LucideWidgetIcon.Widget());

// Registers as 'radix-icon' — safe to call alongside lucide-icon
CMS.registerWidget(RadixWidgetIcon.Widget());
```

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

---

## Editor Components

### Embedded Entry (`decap-cms-editor-component-embedded-entry`)

Adds a markdown shortcode that lets editors link inline content cross-references from within the
markdown editor toolbar. The shortcode format is `embedded-entry` with two quoted arguments:
collection and entry slugs.

```ts
import CMS from '@laikacms/decap-cms';
import { DecapCmsEditorComponentEmbeddedEntry } from '@laikacms/decap-cms/editor-component-embedded-entry';

CMS.registerEditorComponent(DecapCmsEditorComponentEmbeddedEntry);
```

When an editor clicks the "Embedded Entry" toolbar button, Decap shows a two-field form:

| Field      | Widget   | Purpose                                      |
| ---------- | -------- | -------------------------------------------- |
| Collection | `string` | Collection slug to embed from (e.g. `posts`) |
| Entry      | `string` | Entry identifier within that collection      |

The shortcode is stored verbatim in the markdown field and round-trips without data loss:

```md
Here is an inline reference: {{< embedded-entry "posts" "hello-world" >}}
```

To parse the shortcode in your site renderer, match against the pattern `embedded-entry` and extract
the collection + entry slugs from the two quoted arguments.

---

## Package name collision (FYI)

There are **two** packages in the laika-cms ecosystem with confusingly similar names:

- **`@laikacms/decap-cms`** — fork of upstream Decap CMS itself (the React `App`,
  `DecapCmsProvider`, widgets, backends like `backend-github`, etc.). Lives in
  [`laikacms/decap-cms#v4.beta`](https://github.com/laikacms/decap-cms).
- **`@laikacms/decap`** — adapters _around_ Decap: the `laika` Decap backend (`createLaikaBackend`),
  the Decap-compatible HTTP API (`decapApi`), the `decapOauth2` server, custom widgets. Lives in
  this repo under `packages/decap/`.

Their subpath exports do not overlap, so you can `pnpm add` both side by side.
