# starter-railway-blog

Blog deployable to [Railway.app](https://railway.app) — Node.js on Nixpacks (no Dockerfile
required). Demonstrates the **zero-build admin** pattern: `decapAdminHtml()` + `minimalBlogConfig()`
generate the entire Decap admin shell inline, eliminating the `esbuild` + `admin-client.ts` pipeline
needed by most other starters.

## Quick start (local)

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS editor.

## Deploy to Railway

### One-click

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/new)

### Manual

```bash
npm install -g @railway/cli
railway login
railway link          # or `railway init` for a new project
railway up
```

### Persistent content (survives redeploys)

1. Railway dashboard → your service → **Volumes** → **Add Volume**
2. Set mount path to `/data`
3. Add env var `CONTENT_DIR=/data/content` in the service **Variables** tab
4. Redeploy

Without a volume, content is stored in the container filesystem and lost on redeploy.

## Zero-build admin

Most LaikaCMS starters include:

```
src/admin-client.ts   ← esbuild entry
public/admin/
  index.html          ← static HTML
  bundle.js           ← compiled (gitignored)
```

This starter uses `decapAdminHtml()` + `minimalBlogConfig()` instead:

```typescript
// No separate files, no build step
const decapConfig = minimalBlogConfig();
const laika = createEmbeddedLaika({ contentDir, decapConfig, ... });
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'My Admin' });

app.get('/admin', c => c.html(ADMIN_HTML));
```

`decapAdminHtml()` generates an HTML page that loads Decap CMS from `unpkg.com` and the LaikaCMS
backend adapter from `esm.sh` — no local bundle needed. Use the manual pattern only when you need
custom Decap widgets.

## Doc gap surfaced

`decapAdminHtml()` and `minimalBlogConfig()` are not yet prominently featured in the LaikaCMS
quickstart docs. The helper is strictly simpler for projects that don't need custom widgets, but
most code examples still show the manual `esbuild` pipeline.

## railway.toml

```toml
[build]
builder = "nixpacks" # auto-detects Node.js — no Dockerfile
buildCommand = "pnpm install --frozen-lockfile"

[deploy]
startCommand = "pnpm --filter @laikacms/starter-railway-blog start"
healthcheckPath = "/"
restartPolicyType = "always"
```

Railway's [Nixpacks](https://nixpacks.com) builder reads `package.json` and sets up the Node.js
environment automatically. The `pnpm install` buildCommand runs in the build container; the start
command runs in the deploy container.
