# `laika local generate`

Reads the CMS config file (Decap's `config.yaml` by default) and writes a typed TypeScript module
that exposes the config as an `as const` value with inferred literal types. The output is both a
runtime value and its literal types — that's why the command is `generate`, not `types`.

```sh
laika local generate              # auto-discover config.yaml, write config.gen.ts next to it
laika local generate --watch      # regenerate on every save
laika local generate -i src/config.yaml -o src/config.gen.ts
```

## Flags

| Flag       | Alias | Description                                                                                             |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------- |
| `--input`  | `-i`  | Path to the CMS config file (default: auto-discover `./config.{yml,yaml}` or `./src/config.{yml,yaml}`) |
| `--output` | `-o`  | Path of the generated `.ts` (default: `config.gen.ts` next to the input file)                           |
| `--watch`  | `-w`  | Regenerate whenever the input file changes                                                              |
| `--cms`    | —     | CMS whose config format to read (default: `decap`)                                                      |

## Guides

- [Decap → Configuration](../decap/configuration) — the config this generates types for, and why a
  typed config pays off
