# `laika local migrate`

Copies every atom (folder + object) from one storage repository to another — switching
[backends](../backends/fs), taking backups, or seeding an environment. Three input modes:

```sh
# FS shortcut (most common for local dev)
laika local migrate -s ./content -d ./backup

# Named backends (cross-backend: fs → github, webdav → s3, etc.)
laika local migrate \
  --source-backend fs --source-options '{"root":"./content"}' \
  --destination-backend github \
  --destination-options '{"owner":"acme","repo":"content","branch":"main","token":"ghp_..."}'

# Config file
laika local migrate --config migrate.yaml
```

`laika local list-backends` shows every registered backend name and its pinned package version;
missing backend packages are auto-installed unless `--no-install` is set.

## Flags

| Flag                    | Alias | Description                                                                  |
| ----------------------- | ----- | ---------------------------------------------------------------------------- |
| `--config`              | `-c`  | Path to a JSON/YAML `{source, destination, migrate?}` config file            |
| `--source-backend`      | —     | Source backend name (e.g. `fs`, `vercel`, `surrealdb`). See `list-backends`. |
| `--source-options`      | —     | JSON-encoded options object for the source backend                           |
| `--destination-backend` | —     | Destination backend name                                                     |
| `--destination-options` | —     | JSON-encoded options object for the destination backend                      |
| `--source`              | `-s`  | FS shortcut: source root directory                                           |
| `--destination`         | `-d`  | FS shortcut: destination root directory                                      |
| `--from`                | —     | Folder key to start the migration from (default: `''`, the root)             |
| `--overwrite`           | —     | Overwrite objects that already exist on the destination                      |
| `--dry-run`             | —     | Walk the source and log what would happen without writing anything           |
| `--concurrency`         | —     | Parallel copies per folder (default: `4`)                                    |
| `--page-size`           | —     | List page size on the source (default: `1000`)                               |
| `--no-install`          | —     | Refuse to auto-install missing backend packages (fail instead)               |

> Start with `--dry-run` on anything that matters, and note that `--overwrite` is off by default —
> existing destination objects are skipped, not clobbered.
