# `@laikacms/starter-github-storage`

LaikaCMS storing content **directly in a GitHub repository** via the `@laikacms/github`
`GithubStorageRepository`. Every Decap edit becomes a commit. Storage cost: free (GitHub repo).
Version control: automatic. Runtime: any Node-compatible target.

Use this when you want:

- **Version-controlled content.** Edits are commits; diff/blame/revert work out of the box.
- **Free durable storage** without standing up a database or object store.
- **Runtime portability.** Works on Node/Bun/Deno/Workers (with the right HTTPS client) without
  per-platform adapters.

## Stack

- Hono + `@hono/node-server`
- `@laikacms/github/storage-gh` — `GithubStorageRepository` over a GitHub App
- `@laikacms/decap-integrations/custom` — `createCustomLaika`, `minimalBlogConfig`, `decapAdminHtml`

## Setup

1. **Create a GitHub App**: <https://github.com/settings/apps/new>
   - Permissions: `Contents: Read & write` (minimum), `Metadata: Read`.
   - No webhook URL needed.
   - Generate a private key — download the `.pem` file.

2. **Install the app on a repo** you want LaikaCMS to write to.
   - Note the **installation ID** (visible in the install URL or
     `https://github.com/settings/installations`).

3. **Copy `.env.example` → `.env`** and fill in the values. The private key goes in as a single line
   with `\n` for newlines.

4. **Run:**

   ```bash
   pnpm install
   pnpm --filter @laikacms/starter-github-storage dev
   ```

Then:

- `curl http://localhost:3000/` — endpoint index
- Open `http://localhost:3000/admin` — Decap CMS admin
- Create / edit a post → check the GitHub repo: a new commit landed.

## Why `createCustomLaika`?

Because the GitHub storage's constructor is more involved than FS or R2 (App ID + private key +
installation + commit author). The starter builds `GithubStorageRepository` explicitly, then hands
it to `createCustomLaika` — which provides the same `{ fetch, documents, assets }` shape as
`createEmbeddedLaika` and `createWorkersLaika`.

This is the canonical "BYO storage" pattern: build your repo, plug it into `createCustomLaika`,
mount `.fetch` on a catch-all.

## Caveats

- **Latency.** Every write is at least one GitHub API call (often two — read SHA, then PUT). Latency
  is fine for content editing; not for high-throughput writes.
- **API rate limits.** GitHub Apps get 5000 calls/hour per installation. Plenty for editorial
  workflows; possibly not enough for a chatty UI.
- **Branch protection.** If the target branch is protected, the GitHub App needs to be in the bypass
  list (or push to a non-protected branch and merge via PR).

## Production hardening

- Swap `auth: { mode: 'dev' }` for a real `mode: 'custom'` JWT validator.
- Run behind HTTPS (Cloudflare, Caddy, behind a load balancer).
- Consider caching reads in front of `GithubStorageRepository` — content rarely changes faster than
  the cache TTL.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
