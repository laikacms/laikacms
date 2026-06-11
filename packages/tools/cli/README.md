# laikacli

The Laika CMS command-line interface. One npm name, two bins for the same entry point:

- **`laikacli`** — canonical; matches the package name, so `npx laikacli` / `pnpm dlx laikacli` just
  work.
- **`laika`** — short alias once the package is installed.

> Why not publish as `laika`? That npm name is taken by an unrelated (abandoned) package. Bin names,
> however, are per-package — so the short command is still ours.

## Install

```sh
pnpm add -D laikacli   # or npm i -D / yarn add -D
```

Then:

```sh
laika local serve                 # start the local-file JSON:API storage server
laika local generate              # config.yaml -> typed config.gen.ts (add --watch to keep it fresh)
laika local migrate -s ./a -d ./b # copy a storage repository to another backend
laika local list-backends         # show every registered storage backend
```

Or one-off without installing:

```sh
npx laikacli local serve
pnpm dlx laikacli local serve
```

## Commands

All local-file dev tooling lives under the `local` namespace; the top level is reserved for future
non-local commands.

| Command               | What it does                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `local serve`         | Local-file JSON:API storage server for dev workflows (`--root`, `--port`, `--host`, `--auth-token`) |
| `local generate`      | Generate a typed TypeScript module from a Decap CMS `config.yaml`                                   |
| `local migrate`       | Copy every atom from one storage repository to another (fs, vercel, surrealdb, …)                   |
| `local list-backends` | List every registered storage backend and its pinned package version                                |

Run `laika local <command> --help` for the full flag reference.

## Relationship to `@laikacms/local`

The commands are implemented in [`@laikacms/local`](../local) and composed here. `@laikacms/local`
remains the programmatic API (`layerStorageServer`, `generateConfig`, `runMigrate`, …) and still
ships its own `laika-local` bin for backwards compatibility; this package is just the friendlier
front door.
