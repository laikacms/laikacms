---
"@laikacms/local": minor
---

Export the CLI subcommands (`serveCommand`, `generateCommand`, `migrateCommand`,
`listBackendsCommand`) and their `make*Command(name, binName)` factories from the package root so
downstream CLIs can compose them. The new `laikacli` package mounts them under `laika local <cmd>`;
the `laika-local` bin is unchanged.
