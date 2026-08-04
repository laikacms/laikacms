---
"@laikacms/vite-plugin": minor
---

New `mdx` option. A markdown-serialized item deserializes to its frontmatter fields plus `body`;
with `mdx: true` that prose is also written out as a real `.mdx` chunk under `.laika/bodies/` and
the generated module re-exports the compiled component as `Body`, alongside the raw `body` string.
The plugin never compiles MDX and takes no dependency on it — the chunk is an ordinary file, so
`@mdx-js/rollup` (or anything else keyed on the extension) handles it. A file on disk is required
rather than a second virtual module: `createFilter` from `@rollup/pluginutils` rejects ids
containing a NUL byte, so extension-driven plugins can never see a `\0laika:…` id. `Body` is
deliberately kept out of the default export, so importing the data object does not pull the MDX
runtime in with it, and a content field named `Body` is rejected rather than silently shadowed.
Chunks are rewritten and invalidated ahead of the reload in dev, and pruned at the start of every
build.

The default serializer registry — which is keyed by file extension — also gains `.md`, `.mdx` and
`.yml`, so those files are readable at all.
