# Widgets & Editor Components

## Widgets

> **Version requirement:** the widget subpaths (`/widgets/lucide-icon`, `/widgets/radix-icon`,
> `/widgets/aichat`) ship in `@laikacms/decap-cms@alpha` (≥ 4.1.0-alpha.5). They are **not**
> present in `@laikacms/decap-cms@latest` (4.0.4-alpha.3). Install the alpha tag explicitly:
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
import CMS from 'decap-cms-app';
import LucideWidgetIcon from '@laikacms/decap-cms/widgets/lucide-icon';
import RadixWidgetIcon from '@laikacms/decap-cms/widgets/radix-icon';

// Registers as 'lucide-icon'
CMS.registerWidget(LucideWidgetIcon.Widget());

// Registers as 'radix-icon' — safe to call alongside lucide-icon
CMS.registerWidget(RadixWidgetIcon.Widget());
```

> **`decap-cms-app` vs `@laikacms/decap-cms` root import:** use `import CMS from 'decap-cms-app'`
> (consistent with [quickstart-fs.md](./quickstart-fs) and [admin-shell.md](./admin-shell)). The
> `@laikacms/decap-cms` root export (`dist/app/index.js`) imports the Node.js `path` module and
> fails when bundled for the browser with esbuild.

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

## Package name collision (FYI)

There are **two** packages in the laika-cms ecosystem with confusingly similar names:

- **`@laikacms/decap-cms`** — fork of upstream Decap CMS itself (the React `App`,
  `DecapCmsProvider`, widgets, backends like `backend-github`, etc.). Lives in
  [`laikacms/decap-cms#v4.beta`](https://github.com/laikacms/decap-cms).
- **`@laikacms/decap`** — adapters _around_ Decap: the `laika` Decap backend (`createLaikaBackend`),
  the Decap-compatible HTTP API (`decapApi`), the `decapOauth2` server, custom widgets. Lives in
  this repo under `packages/decap/`.

Their subpath exports do not overlap, so you can `pnpm add` both side by side.
