# starter-opfs-blog

A blog where **LaikaCMS runs entirely in the browser** — no server, no database, no git remote.
The Decap admin and the blog both talk to a
[`WebFsStorageRepository`](https://www.npmjs.com/package/laikacms) (`laikacms/storage/web-fs`)
backed by the browser's File System API, wrapped in the same Catalog documents/assets adapters
the server-side stacks use.

## Two storage modes

| Mode | Where content lives | Browser support |
| --- | --- | --- |
| **Browser (OPFS)** — default | The origin-private file system: real files, but invisible to your OS and scoped to this origin. | Every modern browser |
| **Local folder** | A real on-disk folder you pick via `showDirectoryPicker()`. Posts are plain files — open them in your editor, commit them to git. | Chromium (Chrome, Edge, Arc, …) |

Switch modes from the storage bar on the blog home page or above the admin. The picked directory
handle is persisted in IndexedDB, so a reload keeps your folder — but browsers may drop the
permission grant back to "prompt" between visits. The repository surfaces that as a typed
`PermissionPromptRequiredError`, and the UI answers it with a **Restore folder access** button
(re-requesting permission requires a user gesture, so it can't be automatic). If the folder was
deleted or moved (`StaleHandleError`), pick it again.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL — the blog is at `/`, the admin at `/admin/`. The admin logs in automatically:
there is no server to authenticate against, so the `laika` backend runs in `dev_token` mode and a
tiny same-origin fetch shim (`src/local-session.ts`) answers its `/session` and `/health` checks.

## How it's wired

```
src/storage.ts        mode selection (localStorage) + picked-handle persistence (IndexedDB)
                      WebFsStorageRepository → Catalog documents/assets repositories
src/cms.ts            bare Decap app registrations; laika backend with *injected* repositories
src/prism-global.ts   Prism bootstrap the bare app needs before any widget import
src/local-session.ts  fetch shim for the backend's /session + /health endpoints
src/admin.ts          admin entry: storage bar + init() with dev_token backend config
src/main.tsx          the blog: hash-routed SPA reading posts from the documents repository
```

The repository validates permission and liveness on every operation, so nothing here caches access
state — a mid-session revocation shows up as a typed error, not silent breakage.

## What this is (and isn't) for

Local-first demos, offline drafting, trying LaikaCMS without infrastructure, and editing a real
content folder on disk without running a server. It is **not** multi-user and has **no access
control** — everything behind the directory handle is readable and writable by any script that
obtains it, and OPFS data can be evicted under storage pressure unless the origin holds persistent
storage permission. Treat it as a working copy, not a system of record; put nothing secret in it.
