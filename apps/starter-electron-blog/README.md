# starter-electron-blog

Desktop blog editor built with [Electron](https://www.electronjs.org/) + LaikaCMS. The HTTP server
runs inside the Electron main process, content is stored in the OS user-data directory
(`app.getPath('userData')`), and a `BrowserWindow` loads `http://127.0.0.1:<port>/` — the same
origin as the Decap admin, so cookies and `fetch()` work with no CORS configuration.

## Quick start

```bash
pnpm install
pnpm dev       # builds main + admin bundles, then opens the Electron window
```

The window opens to the blog index at `/`. Click **Open CMS ↗** in the top nav to launch the Decap
admin.

Content is written to:

| OS      | Path                                                   |
| ------- | ------------------------------------------------------ |
| macOS   | `~/Library/Application Support/LaikaCMS Blog/content/` |
| Windows | `%APPDATA%\LaikaCMS Blog\content\`                     |
| Linux   | `~/.config/LaikaCMS Blog/content/`                     |

## Architecture

```
src/
  main.ts               # Electron main process — HTTP server + BrowserWindow
  admin-client.ts       # esbuild entry → public/admin/bundle.js
  lib/
    decap-config.ts     # Shared Decap collection schema
public/
  admin/
    index.html          # Decap admin page (git-tracked)
    bundle.js           # ← generated (gitignored)
dist/
  main.js               # ← compiled main process (gitignored)
```

## Why port 0?

```typescript
httpServer.listen(0, '127.0.0.1', () => {
  const { port } = httpServer.address() as AddressInfo;
  win.loadURL(`http://127.0.0.1:${port}/`);
});
```

Port `0` tells the OS to pick any free port. This avoids conflicts with other services and is safe
for a loopback-only server. The port is passed directly to `BrowserWindow.loadURL()` before any
external code can observe it.

## Doc gap surfaced

**`createEmbeddedLaika` must be called inside `app.whenReady()`**, not at module top level.

`app.getPath('userData')` returns a path with a blank app name on Windows and macOS until the app is
fully initialised:

```typescript
// ❌ Wrong — app not ready yet, getPath() returns "…//content" on macOS
const laika = createEmbeddedLaika({ contentDir: join(app.getPath('userData'), 'content'), ... });

// ✅ Correct — called inside whenReady()
app.whenReady().then(() => {
  const laika = createEmbeddedLaika({ contentDir: join(app.getPath('userData'), 'content'), ... });
  // ...
});
```

This is analogous to the Next.js "server-side only" rule: initialise singletons where the runtime
guarantees the environment is ready, not at import time.

## Build pipeline

The main process is compiled with esbuild
(`--bundle --platform=node --format=esm
--external:electron`). Electron v28+ supports ESM in the main
process when `"type": "module"` is set in `package.json`.

```bash
pnpm build:main   # src/main.ts → dist/main.js (2 MB bundled)
pnpm build:admin  # src/admin-client.ts → public/admin/bundle.js
pnpm start        # electron . (uses pre-built dist/main.js)
```

## Packaging for distribution

For distributing a standalone `.app` / `.exe` / `.AppImage`, add
[electron-forge](https://www.electronforge.io/) or [electron-builder](https://www.electron.build/)
as a dev dependency and run their `package`/`make` commands. Content stored in `userData` is
preserved across app updates.
