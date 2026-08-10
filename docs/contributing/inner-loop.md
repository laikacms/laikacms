# Inner loop

## Commands

All of these run through [Turborepo](https://turbo.build/) at the workspace root, so each only
rebuilds/retests the packages affected by your change (see `turbo.json`).

| Command             | What it does                                                                   |
| ------------------- | ------------------------------------------------------------------------------ |
| `pnpm build`        | `turbo run build` — compiles every package (`tsc`), Astro/VitePress sites too. |
| `pnpm test`         | `turbo run test` — builds first, then `vitest run` per package.                |
| `pnpm typecheck`    | `turbo run typecheck` — `tsc --noEmit` per package.                            |
| `pnpm lint`         | `eslint --cache --config eslint.config.mjs .` across the whole repo.           |
| `pnpm lint:fix`     | Same, with `--fix`.                                                            |
| `pnpm format`       | `dprint fmt` — formats TS/JS/JSON/Markdown/TOML per `dprint.json`.             |
| `pnpm format:check` | Same, without writing — fails if anything is unformatted.                      |
| `pnpm dev`          | `turbo watch dev` — watch-mode build across the workspace.                     |
| `pnpm coverage`     | `turbo run test` with v8 coverage reporters.                                   |

Per-package equivalents work too, e.g. `pnpm --filter laikacms test` or
`pnpm --filter @laikacms/server typecheck`.

Before pushing, run at minimum:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

— this mirrors the `pre-push` hook (see [Landing a PR](./landing-a-pr)), so a clean local run means
the hook will pass too.

## Where code lives

Each core package (`laikacms`, `@laikacms/server`) is organized by layer under `src/`:

```
packages/laikacms/src/
  domain/      interfaces — StorageRepository, DocumentsRepository, ...
  impl/        implementations — storage-fs, storage-r2, documents-drizzle, ...
  api/         HTTP surface — storage-api, documents-api, contentbase-api, ...
  serializers/ content (de)serialization — markdown, raw, ...
  shared/      no internal deps — core, crypto, i18n, json-api
```

Tests live next to the code they cover as `*.test.ts` (e.g.
`packages/laikacms/src/api/storage-api/authorize.test.ts`), run by `vitest run` from that package's
root.

## Adding a new domain/impl/api triple

Follow the shape of an existing one — e.g. `domain/storage`, `impl/storage-fs`, `api/storage-api`
under `packages/laikacms/src`:

1. **Domain**: define the interface as an abstract class or interface in `domain/<name>`. No
   Node-specific APIs, no concrete backend deps (see [House style](./house-style)).
2. **Impl**: implement it for a specific backend in `impl/<name>-<backend>`, depending only on the
   domain package.
3. **API** (if it needs an HTTP surface): expose it in `api/<name>-api`, depending on the domain
   package, not a specific implementation.
4. Export the new subpaths from the package's `package.json` `exports` map, matching the pattern of
   an existing subpath (e.g. `laikacms/storage-fs`).
5. Add `*.test.ts` files alongside the new code.

Cross-cutting rules: **domain** packages declare no internal dependencies beyond `shared`;
**implementation** packages depend on **domain**, never on another implementation; **API** packages
depend on **domain**, not on implementations (see [Architecture](../concepts/architecture)).

## Docs for a package you're changing

If your change is package-specific reference/usage material, it belongs in `packages/<pkg>/docs/`
(see [Package reference docs](./package-docs)), not hand-authored in `docs/reference/`.
