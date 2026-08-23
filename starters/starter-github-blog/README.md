# starter-github-blog

A minimal blog powered by [Hono](https://hono.dev/) + [LaikaCMS](https://laikacms.dev/) that stores
all content directly in a GitHub repository via the GitHub API. Every save in the Decap CMS admin
becomes a commit on your content branch, giving you a full audit trail and the ability to deploy
from the same repo that powers your CMS.

## Prerequisites

- Node.js ≥ 22
- A GitHub App with **Contents (Read & Write)** and **Metadata (Read)** permissions installed on your content repo

## Quick start

> **Temporarily unavailable for standalone use.** This starter requires `@laikacms/github@>=1.0.4`
> which is not yet published to npm (registry has 1.0.0; the `/storage-gh` subpath this starter
> imports was added in 1.0.4). Running `npm install` gets the old version and the server fails at
> runtime. Use the [Working from the monorepo](#working-from-the-monorepo) steps below until
> `@laikacms/github@1.0.4` is released.

Once the package is published:

```bash
# 1. Copy and fill in credentials
cp .env.example .env
$EDITOR .env

# 2. Install dependencies
npm install

# 3. Start the dev server (builds admin bundle, then watches src/)
npm run dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin/> for the CMS editor.

## Working from the monorepo

If you cloned the `laikacms` repository and are running this starter in-place (not via the wizard),
the `starters/pnpm-workspace.yaml` carries `link:` overrides pointing at local builds of packages
that are ahead of npm. Build those packages first, then install and run:

```sh
# Build the linked packages (run from this directory)
pnpm -C ../.. --filter laikacms --filter @laikacms/server --filter @laikacms/github build

pnpm install
pnpm dev
```

## Creating a GitHub App

1. Go to <https://github.com/settings/apps/new>
2. Set any Homepage URL (e.g. `http://localhost:3000`)
3. Uncheck **Webhook → Active**
4. Under **Permissions → Repository permissions**, set **Contents** to *Read & Write* and **Metadata** to *Read-only*
5. Click **Create GitHub App**
6. Generate a **private key** — save the downloaded `.pem` as the value of `GITHUB_APP_PRIVATE_KEY` (with `\n` between lines)
7. Install the app on your content repo and note the **Installation ID** from the URL

## Environment variables

| Variable | Description |
|---|---|
| `GITHUB_APP_ID` | Numeric App ID from the GitHub App settings page |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key (use `\n` for newlines in `.env`) |
| `GITHUB_APP_INSTALLATION_ID` | Installation ID (from the install URL) |
| `GITHUB_OWNER` | Repo owner — org name or GitHub username |
| `GITHUB_REPO` | Repository name where content is stored |
| `GITHUB_BRANCH` | Branch for content commits (default: `main`) |

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Build admin bundle and start the server with file-watching |
| `npm run build` | Build the admin bundle only |
| `npm start` | Start the server (no watch, no admin rebuild) |
| `npm run typecheck` | TypeScript type-check without emitting |
