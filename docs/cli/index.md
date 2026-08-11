# CLI

`laikacli` is the LaikaCMS command-line interface. This section is pure flag reference — each
command's guide (the _why_) lives with its topic and is linked from its page.

## Install

```sh
pnpm add -D laikacli   # or npm i -D / yarn add -D
```

One npm name, two bins for the same entry point:

- **`laikacli`** — canonical; matches the package name, so `npx laikacli` / `pnpm dlx laikacli` just
  work.
- **`laika`** — short alias once the package is installed. (The `laika` npm _name_ is taken by an
  unrelated abandoned package; bin names are per-package, so the short command is still ours.)

One-off without installing:

```sh
npx laikacli local serve
pnpm dlx laikacli local serve
```

## Commands

All local-file dev tooling lives under the `local` namespace; the top level is reserved for future
non-local commands.

| Command                        | What it does                                                 |
| ------------------------------ | ------------------------------------------------------------ |
| [`create`](./create)           | Wizard that bootstraps a starter app                         |
| [`local serve`](./serve)       | Local-file JSON:API storage server                           |
| [`local generate`](./generate) | Typed TypeScript codegen from the CMS config file            |
| [`local migrate`](./migrate)   | Copy every atom from one storage backend to another          |
| `local list-backends`          | List every registered storage backend and its pinned version |

Run `laika local <command> --help` for the built-in flag reference.

## Programmatic API

Everything the CLI does is also exported from the package root — `layerStorageServer`,
`generateConfig`, `runMigrate`, the storage driver registry, and the `make*Command` factories for
embedding the subcommands in another Effect CLI:

```ts
import { generateConfig, layerStorageServer, runMigrate } from 'laikacli';
```

> `laikacli` supersedes the deprecated `@laikacms/local` package.
