# @laikacms/vite-plugin — roadmap

Living design doc for the build-time content loader. Not shipped in the npm tarball. Everything
under **Shipped** landed in the unreleased `2.2.0` (see [CHANGELOG.md](./CHANGELOG.md)); **Planned**
items are not built yet.

## Shipped

- **`laika:` protocol loader** — `laika:doc/<key>` (documents repo, `getDocument`) and
  `laika:store/<key>` (storage repo, `getObject`) resolve to virtual ES modules read at build time.
- **Per-field tree-shakable exports** — one named export per top-level content field + `$`-meta +
  default; importing `{ title }` drops the rest of the item from the bundle.
- **`import.meta.glob('laika:…')`** — expanded at transform time by listing the repository, using
  `es-module-lexer` + `magic-string` (sourcemaps, string/comment-safe). Supports `eager`,
  `import: '<field>'`, `!` exclusions, `*` vs `**`.
- **Repository change channel + hot reload** — a push `subscribeChanges` primitive on
  `StorageRepository` (fs via `fs.watch`, multicast + debounced), consumed by the plugin to
  invalidate `\0laika:*` modules and trigger dev reload. Reusable by remote repos later.
- **MDX bodies (`mdx: true`)** — a markdown-serialized item's `body` is written out as a real `.mdx`
  chunk under `.laika/bodies/` and re-exported as `Body`. The plugin does not compile MDX and takes
  no dependency on it: the chunk is a plain file, so `@mdx-js/rollup` (or anything else keyed on the
  extension) picks it up. A real file is required — `createFilter` from `@rollup/pluginutils`
  rejects ids containing a NUL byte, so a `\0laika:…` virtual module can never reach those plugins.
- **TypeScript IntelliSense (typegen)** — the plugin emits a value-module from the fetched data and
  runs the TypeScript compiler API to produce a per-item `declare module 'laika:…'` (compiler does
  the inference → zero drift), plus per-collection union aliases for glob typing. Written to
  `.laika/` + a committed `laika-env.d.ts`; regenerates off the change channel.

## Planned

### 1. Filters passed through to the backend

Today `import.meta.glob('laika:doc/posts/*')` lists everything under the folder and filters
client-side with `minimatch`. Instead, surface the repository's native listing filters and pass them
**down to the backend** so the scoping happens server-side (cheaper, and correct for repos that
can't enumerate everything).

The listing APIs already accept these: documents `ListRecordsOptions` has `type` (`published` |
`unpublished` | `all`), `folder`, `depth`, `statuses`; storage `listAtomSummaries` has `depth`.

**Sketch:** carry filters as a query on the id/pattern, e.g.

```ts
import.meta.glob('laika:doc/posts/*?filter[type]=published&filter[depth]=2');
```

The glob rewriter parses the query, maps it to `ListRecordsOptions`/`ListAtomsOptions`, and passes
it to `listKeys` (which stops being "list-all-then-minimatch" and becomes "list-with-filters,
minimatch only the residual pattern"). A dedicated typed helper (`laikaGlob(pattern, { filter })`)
is an alternative to stringly-typed query params — decide during design.

**Open questions:** query-string vs typed-options ergonomics; how filters compose with the `*`/`**`
pattern; whether to expose repository-native/custom filters generically or only the known ones; how
filtered lists are reflected in the generated glob-alias types.

### 2. Summaries-only mode (don't fetch full content)

For an index page ("list of all blog posts") you want each item's key + lightweight metadata,
**not** its full body. Right now every matched id is a full `getDocument`/`getObject` (reads +
inlines the whole content object). Add a mode that returns the **summary** — backed by
`listRecordSummaries` / `listAtomSummaries`, which already return `RecordSummary` / `AtomSummary`
(key, language, status, version, …) without the content payload.

**Sketch:** a `?summary` marker, e.g.

```ts
const index = import.meta.glob('laika:doc/posts/*?summary', { eager: true });
// value = { key, language, status, version } — no content read
```

and for a single item `import summary from 'laika:doc/posts/hello?summary'`. Pairs naturally with
item (1): filter + summarize in one backend listing call. Big win for large collections — one list
call instead of N content reads.

**Open questions:** exact summary shape exposed per namespace; interaction with per-field
tree-shaking (summaries have a fixed small field set); typegen must emit a distinct summary type;
whether `{ import: 'title' }` is even meaningful in summary mode (title usually isn't in a summary).

### 3. Assets namespace — `laika:asset/<key>` → emitted binary + dist URL

**Not currently handled.** Add an `asset` namespace that treats the key as a binary, hands the bytes
to Vite's asset pipeline, and exports the resulting URL — i.e. the hashed path in `dist/assets/`
where the file lands.

**Sketch:**

- Read bytes from the assets repository (`AssetsRepository` / `assets-contentbase`, built on
  storage) — extend `createRepositories` to also build an assets repo.
- **Build:** `this.emitFile({ type: 'asset', name, source: bytes })` → reference id; the module
  exports `import.meta.ROLLUP_FILE_URL_<id>`, which Rollup/Rolldown rewrites to the final hashed URL
  (`/assets/logo-a1b2c3.png`). So `import logoUrl from 'laika:asset/media/logo.png'` yields the dist
  location of the binary.
- **Dev:** no dist folder — serve the bytes from a dev middleware at a stable URL (e.g.
  `/@laika-asset/<key>`) and return that URL, so `laika:asset/*` behaves the same in `vite dev` and
  `vite build`.
- Default export = URL string. Optionally named exports for asset metadata (mime, width/height,
  size) when the repo/variations expose it. Typegen types the module as `{ default: string }` (+ any
  metadata fields).
- Ties into the change channel: a changed asset invalidates its module and re-emits.

**Open questions:** dev URL scheme + middleware (the one server-side piece in an otherwise
build-time plugin); how asset _variations_ (from `ContentBaseAssetsRepository.createVariations`) are
exposed — multiple named URL exports?; whether large assets should be `emitFile`d always or inlined
under a size threshold like Vite's `assetsInlineLimit`; interaction with
`import.meta.glob('laika:asset/*')` returning a map of URLs.
