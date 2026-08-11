# `laika create`

Wizard that bootstraps a [starter app](../getting-started/starters) — the supported way to start a
LaikaCMS app; always go through it rather than copying a starter folder.

On a terminal it walks through every choice: the starter template, target directory, site title,
package manager, and — because every starter boots the bare Decap app
(`@laikacms/decap-cms/laika-app/bare`) with nothing pre-registered — which CMS **backends**,
**widgets**, and extra admin UI **locales** to install. The selection is written to the generated
app's `src/cms.ts`; re-run the wizard or edit that file to change it later.

## Scripted usage

Each prompt can be pre-answered with a flag:

```sh
laika create --starter starter-hono-blog --name my-blog --directory ./my-blog \
  --title "My Blog" --package-manager npm \
  --backends laika --widgets string,datetime,richtext --locales nl,de

laika create --yes          # accept all defaults, no prompts (also the no-TTY behavior)
laika create --skip-install # scaffold without running the package manager
```

## Flags

| Flag                 | Description                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `--directory` / `-d` | Target directory (default: `./my-laika-app`; wizard asks)                                   |
| `--starter`          | Starter template to use (default: first in list; wizard asks when >1 exists)                |
| `--name`             | `package.json` `name` field (default: directory name)                                       |
| `--title`            | Site title written to the starter (default: `My Blog`; wizard asks)                         |
| `--package-manager`  | `pnpm` / `npm` / `yarn` / `bun` (default: `pnpm`; wizard asks)                              |
| `--skip-install`     | Scaffold the app without installing dependencies                                            |
| `--cms`              | CMS adapter to use (default: `decap`; wizard skips while only one exists)                   |
| `--backends`         | Comma-separated CMS backends to register (wizard asks; adapter-specific)                    |
| `--widgets`          | Comma-separated widgets to register (wizard asks; adapter-specific)                         |
| `--locales`          | Comma-separated extra admin UI locales (`en` is built in; wizard asks)                      |
| `--yes` / `-y`       | Accept all defaults and skip wizard prompts (also activated when stdin/stdout is not a TTY) |

## Which CMS?

The admin UI is a plug-in choice, selected with `--cms`. Decap is the only adapter today, so the
wizard skips the question. Each CMS owns its own catalogs, so `--backends`, `--widgets`, and
`--locales` are read against the selected CMS.

Note that a CMS **backend** here (a content source the admin UI talks to) is a different axis from a
**storage backend** ([`local migrate`](./migrate), `local list-backends`).

## Guides

- [Quickstarts](../getting-started/vite) — every quickstart's "new project" track starts here
- [Starters gallery](../getting-started/starters) — what each template demonstrates
