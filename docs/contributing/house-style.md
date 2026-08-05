# House style

## Principles

- **Removing code is more valuable than adding code.**
- **Modularity** — each package has a single responsibility.
- **Runtime-agnostic** — no Node.js-specific APIs in domain/core packages; implementation packages
  (`storage-fs`, …) are where runtime-specific code belongs.
- **Minimal dependencies** — keep bundle sizes small; don't add a heavy dependency without
  discussion.

## Naming

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions: `camelCase`
- Tests: `<name>.test.ts`, colocated with the code they cover.

## Dependencies

- Internal (workspace) dependencies: `workspace:*`.
- Shared external dependencies: `catalog:` references (see the `catalogs` block in
  `pnpm-workspace.yaml`) rather than pinning a version directly in a package's `package.json`.

## Formatting and linting

- `dprint fmt` / `pnpm format` is the formatter (`dprint.json`: 2-space indent, single quotes,
  semicolons, 120-char line width for code). `pnpm format:check` is the pre-commit gate.
- ESLint (`eslint.config.mjs`) runs `@typescript-eslint/recommended` plus repo rules; notably
  `no-explicit-any` and `no-unused-vars` are warnings, not hard errors — still avoid `any` where a
  real type is easy to write.
- `apps/website` additionally bans em dashes (`—`) in user-visible copy — use a colon, comma, or
  restructure the sentence.

## Layering

Follow the domain/impl/api layering described in [Orientation](./#orientation) and
[Architecture](../concepts/architecture): domain packages define interfaces and have no internal
deps beyond `shared`; implementation packages depend on domain, never on another implementation; API
packages depend on domain, not on implementations.

## Effect-based repositories

Repository methods return `LaikaTask<T>` (single result) or `LaikaStream<T, D>` (multiple results
with a typed done value) — both Effect-based. Consume them via the `laikacms/compat` helpers
(`runTask`, `collectStream`) rather than importing Effect directly in calling code.

When a higher-level repository delegates to a lower-level one, use the **forwarding** drainers
(`LaikaTask.runValueForwarding`, `LaikaStream.runCollectForwarding`) so recoverable warnings
propagate to the outer caller instead of being dropped at the delegation boundary. `runValue` /
`runCollect` (non-forwarding) are correct only at a true top-level boundary — an API server draining
a task into a `Promise`, test setup, etc.

## Docs

- Package-specific reference/usage docs live in `packages/<pkg>/docs/`, not hand-authored centrally
  — see [Package reference docs](./package-docs).
- This `contributing/` section and `docs/` in general stay evergreen: no dated point-in-time
  snapshots. Design decisions (ADRs, incident write-ups) are recorded internally, not published
  here.
