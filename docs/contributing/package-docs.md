# Package reference docs

Package-specific reference/usage docs live **with the package**, not hand-authored centrally — that
way they stay in sync with the code and are reviewed in the same PR as the change that prompted
them. Cross-cutting narrative (getting started, concepts, guides that span more than one package)
stays hand-authored in `docs/`.

## Where to put them

```
packages/<pkg>/docs/
  index.md      # required — the package's landing page under Reference > Packages
  usage.md      # optional additional pages
  widgets/
    foo.md
```

A `packages/**/docs` prebuild step (`docs/scripts/aggregate-package-docs.mjs`) discovers these files
and aggregates them into the VitePress site every time `pnpm --filter @laikacms/docs dev` or `build`
runs. It is **not** a separate/parallel build — `docs/package.json`'s `dev` and `build` scripts
always run it first, so `pnpm build` at the workspace root picks it up automatically via
`turbo run build`.

The aggregation output (`docs/reference/packages/**` and
`docs/.vitepress/generated/package-sidebar.json`) is entirely generated and git-ignored. Never
hand-edit it — it's wiped and rebuilt from scratch on every run.

## Convention

- Every markdown file needs frontmatter `title`:
  ```md
  ---
  title: Usage
  order: 1
  ---
  ```
- `order` (number, optional) controls position — within a package for non-index pages, and between
  packages for `index.md`. Missing `order` sorts last, alphabetically by title among ties.
- Link to other pages in the same package's docs with normal relative markdown links
  (`[usage](./usage.md)`); the aggregation step rewrites nothing but validates that relative links
  and asset references resolve to a real file under `packages/<pkg>/docs/`, and fails the build
  loudly if one doesn't.
- Non-markdown files (images, etc.) referenced by relative path are copied alongside the page, so
  they keep resolving after aggregation.

## URL scheme

A package's docs are served under `/reference/packages/<pkg>/`:

| Source                               | Site URL                                |
| ------------------------------------ | --------------------------------------- |
| `packages/<pkg>/docs/index.md`       | `/reference/packages/<pkg>/`            |
| `packages/<pkg>/docs/usage.md`       | `/reference/packages/<pkg>/usage`       |
| `packages/<pkg>/docs/widgets/foo.md` | `/reference/packages/<pkg>/widgets/foo` |

`<pkg>` is the package's folder name under `packages/` (e.g. `laikacms`, `decap`), not its npm name.

## Testing the aggregation step

`docs/scripts/aggregate-package-docs.test.mjs` runs the aggregation against fixture packages and
asserts pages appear, the sidebar lists them in order, aggregation is idempotent (a second run
against unchanged input is byte-identical), and both a missing `title` and a broken relative link
fail the build loudly. Run it with `pnpm --filter @laikacms/docs test`.
