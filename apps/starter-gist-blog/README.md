# starter-gist-blog

LaikaCMS blog starter backed by **GitHub Gist** (`GistStorageRepository` from
`@laikacms/gist/storage-gist`). Every content operation goes through exactly two GitHub API
endpoints: `GET /gists/{id}` to read, `PATCH /gists/{id}` to write.

## Why GitHub Gist

Three quirks unique to the Gist backend in the LaikaCMS suite:

1. **Atomic multi-file PATCH.** `PATCH /gists/{id}` accepts a full file-delta map:
   `{ files: { "a.md": { content: "..." }, "b.md": null } }`. Creates, updates, and deletes all land
   as a single revision in the gist's git history. `removeAtoms(N)` resolves all N keys then ships
   one PATCH — not N.

2. **`/` is forbidden in gist filenames.** The data source encodes `/` → `__` and decodes on read:
   `storage key "notes/hello"` → `gist filename "notes__hello.md"`. Keys containing `__` are
   rejected upfront with `BadRequestError` so the encoding stays unambiguous.

3. **Single-gist scope.** One gist = one content repository. Bounded at ~300 files and ~1MB total.
   The gist must exist before starting — create it manually at gist.github.com.

## Quick start

1. Create a gist at [gist.github.com](https://gist.github.com) (one placeholder file is fine).
2. Copy the 32-char gist ID from the URL.
3. Create a GitHub PAT with `gist` scope at
   [github.com/settings/tokens](https://github.com/settings/tokens).
4. Copy `.env.example` → `.env` and fill in `GIST_ID` and `GITHUB_PAT`.
5. `pnpm dev`

Open `http://localhost:3000/admin` → write a post → visit your gist on GitHub to see the files.

## Environment variables

| Variable     | Required | Description                  |
| ------------ | -------- | ---------------------------- |
| `GIST_ID`    | ✅       | 32-char gist ID from the URL |
| `GITHUB_PAT` | ✅       | PAT with `gist` scope        |
| `PORT`       | optional | HTTP port (default: `3000`)  |

## Caveats

- **Storage ceiling.** GitHub recommends keeping gists under ~300 files and ~1MB. For larger blogs
  use a different backend.
- **No `__` in keys.** Keys containing `__` (double underscore) are rejected because `__` is the
  `/`-encoding. Avoid this in your post slugs.
- **Rate limits.** The GitHub API limits unauthenticated requests to 60/hour and authenticated to
  5000/hour. Each read does one `GET`; each write does one `GET` + one `PATCH`.
- **Gist visibility.** Secret gists are not indexed by search engines but are accessible to anyone
  with the URL. Don't store sensitive content.
