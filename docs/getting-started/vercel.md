# Quickstart: Vercel

By the end of this page you'll have the [Next.js quickstart](./nextjs) running on Vercel with
content in a GitHub repository — because Vercel's serverless filesystem is **read-only**, the
filesystem backend from the local quickstart can't hold your content in production. Any remote
[backend](../backends/github) works; this page uses GitHub so content edits become commits.

> No Vercel starter template yet — this quickstart adapts the Next.js one.

## 1. Swap the storage backend

Replace `createEmbeddedLaika` (filesystem-bound) with the same stack over
[`GithubStorageRepository`](../backends/github):

```ts
// lib/laika.ts
import { GithubStorageRepository } from '@laikacms/github/storage-gh';
import { laikaApi } from '@laikacms/server/api';
import { CatalogAssetsRepository } from 'laikacms/assets-catalog';
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';
import { CatalogDocumentsRepository } from 'laikacms/documents-catalog';

const storage = new GithubStorageRepository({
  appId: process.env.GITHUB_APP_ID!,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
  installationId: process.env.GITHUB_APP_INSTALLATION_ID!,
  owner: 'your-org',
  repo: 'your-content-repo',
  branch: 'main',
});

const settings = new ConventionCatalogProvider({ storage });
export const documents = new CatalogDocumentsRepository(storage, settings);
const assets = new CatalogAssetsRepository(storage, settings);

export const laika = laikaApi({
  documents,
  storage,
  assets,
  basePath: '/api/decap',
  authenticateAccessToken: async token => {
    if (token !== process.env.DEV_TOKEN) throw new Error('Unauthorized'); // dev only
    return { id: 'dev', email: 'dev@local.test' };
  },
  authorize: () => true,
});
```

The route handler, admin page, and blog pages from the
[Next.js quickstart](./nextjs#_2-mount-the-api-as-a-route-handler) stay identical — that's the point
of the repository contract.

(Create the GitHub App under your org → Settings → Developer settings, grant it Contents read/write
on the content repo, and install it there.)

## 2. Configure and deploy

```sh
vercel env add GITHUB_APP_ID
vercel env add GITHUB_APP_PRIVATE_KEY
vercel env add GITHUB_APP_INSTALLATION_ID
vercel env add DEV_TOKEN
vercel deploy
```

Open `https://your-app.vercel.app/admin`, log in, publish a post — it lands as a commit in your
content repo, and the next request to `/blog/<slug>` reads it from GitHub.

## Notes for serverless

- **Cold starts:** module-level repository construction (as above) is reused across warm
  invocations; nothing else is needed.
- **Public reads without tokens:** for high-traffic public pages, read through the
  [GitHub CDN backend](../backends/github-cdn) (or cache at the framework layer) so page views don't
  spend GitHub API rate limit — keep the authenticated repository for writes.
- **A dev token is not production auth.** Before sharing the URL, wire real auth — see
  [Decap → Authentication](../decap/auth) and [Middleware → OAuth2](../middleware/oauth2).

## Next steps

- [Deploy to Production](./deploy) — the full hardening checklist
- [Backends](../backends/gitlab) — the same swap works for GitLab, Bitbucket, S3, or SQL
