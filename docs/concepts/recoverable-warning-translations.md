# Recoverable-warning translation-key convention

`LaikaError` carries an optional `translation` field:

```ts
public translation?: { title?: TranslationKey, message?: TranslationKey };
```

`TranslationKey` (`import type { TranslationKey } from 'laikacms/i18n'`) is `keyof Translation`,
where `Translation` is the flat key→string catalog declared in
`packages/laikacms/src/shared/i18n/types.ts` and populated per-locale in
`packages/laikacms/src/shared/i18n/translations/{en,nl}.ts`. `en.ts` is the source of truth: every
key added there must get a matching entry in every other locale file (enforced by
`translations.test.ts`).

This doc defines the key-naming convention for warnings emitted via `emit.recoverableError(...)`
(the `LaikaStream` partial-success channel — see `ROADMAP.md`, "Recoverable-warning pipeline"), and
the code pattern for attaching `translation.message` (and optionally `translation.title`) when a
backend constructs a recoverable `LaikaError`.

## Key naming scheme

```
storage.<backend>.<situation>
```

- `<backend>` is the implementation package's short name (`fs`, `r2`, `s3`, `drizzle`, `webdav`, …)
  — the same slug used in the `packages/laikacms/src/impl/storage-<backend>` directory name.
- `<situation>` is a lowerCamelCase description of _why_ the error occurred, independent of the
  specific path/key/id involved (those stay in the untranslated `message` passed to the `Error`
  constructor for logs — translation keys must not embed interpolated identifiers). Reuse a
  `<situation>` segment across every call site that reports the same underlying condition (e.g.
  every "file not found" branch across a backend's datasource uses `storage.fs.fileNotFound`), so
  the catalog doesn't grow one key per call site.

Examples added for `storage-fs` (see `packages/laikacms/src/shared/i18n/translations/en.ts`):
`storage.fs.fileNotFound`, `storage.fs.directoryNotFound`, `storage.fs.permissionDenied`,
`storage.fs.directoryNotEmpty`, `storage.fs.expectedFileFoundDirectory`,
`storage.fs.expectedDirectoryFoundFile`, `storage.fs.entryTypeUnsupported`,
`storage.fs.pathTraversalRejected`, `storage.fs.entryAlreadyExists`, `storage.fs.contentRequired`,
`storage.fs.invalidRequest`, `storage.fs.failedToReadFile`, `storage.fs.failedToGetFileMetadata`,
`storage.fs.failedToGetDirectoryMetadata`, `storage.fs.failedToListDirectory`,
`storage.fs.failedToListDrives`, `storage.fs.unexpectedFileSystemError`.

Non-storage backends (`documents-jsonapi-proxy`, `contentbase`, `obsidian`, …) should use the same
`<package>.<situation>` shape with their own package slug in place of `storage.<backend>` (e.g.
`documentsJsonapiProxy.upstreamTimeout`) — this convention isn't storage-specific, `storage-fs` is
just the reference implementation for LCMS-471.

## Where keys live

Add the key to three places, in this order:

1. `packages/laikacms/src/shared/i18n/types.ts` — add the key to the `Translation` interface
   (quoted, since it contains dots), typed `string`.
2. `packages/laikacms/src/shared/i18n/translations/en.ts` — add the canonical English string. This
   is the locale `translations.test.ts` diffs every other locale against.
3. `packages/laikacms/src/shared/i18n/translations/nl.ts` — add the Dutch translation. CI
   (`pnpm
   test`) fails if a locale is missing a key `en.ts` declares.

`TranslationKey` is exported from the package's `./i18n` subpath export (`laikacms/i18n`), which is
what `errors.ts` already imports — no new export wiring is required once the key exists in
`Translation`.

## Attaching `translation.message` at construction time

Set `translation` in the `options` object passed to the `LaikaError` subclass constructor, at the
same call site that already builds the human-readable `message` string. Do **not** set it later at
the `emit.recoverableError(...)` call site — by the time an error reaches there it may have
originated several layers down (e.g. a repository forwards a datasource's `Result.fail`), so
attaching the key where the error is actually constructed is the only place with enough context to
pick the right key, and it also covers non-recoverable (fatal) uses of the same error class for
free.

```ts
// packages/laikacms/src/impl/storage-fs/infrastructure/datasources/filesystem-datasource.ts
return Result.fail(
  new NotFoundError(`The file at ${fullPath} does not exist`, {
    cause: error,
    translation: { message: 'storage.fs.fileNotFound' },
  }),
);
```

`translation.title` is optional and only worth setting when a warning needs a distinct localized
title from the error class's static `TITLE` (most recoverable warnings don't; omit it unless the UI
needs it).

## Consuming side (Decap UI)

A consumer with the `translation.message` key can resolve display text via the existing catalog,
e.g.:

```ts
import { defaultMessages } from 'laikacms/i18n';
import type { Translation } from 'laikacms/i18n';

function localize(key: string, catalog: Translation = defaultMessages): string {
  return (catalog as Record<string, string>)[key] ?? key;
}
```

Until the Decap UI's partial-success affordance lands (tracked separately in `ROADMAP.md`), backends
should still pass a good plain-English `message` to the `Error` constructor — `translation.message`
is additive, not a replacement for the English fallback string.

## Reference implementation

`storage-fs` (`packages/laikacms/src/impl/storage-fs/`) is the reference implementation: every
`LaikaError` constructed in its datasource, repository, and `utilities.ts` error-mapping helper sets
`translation.message` per the scheme above. Other backends (`storage-r2`, `storage-s3`,
`storage-drizzle`, `storage-webdav`, `documents-jsonapi-proxy`, `contentbase`, `obsidian`, …) are
follow-up work — apply the same pattern per-backend rather than in one large cross-cutting change.
