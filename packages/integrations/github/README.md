# @laikacms/integrations-github

GitHub-backed `StorageRepository` for Laika CMS. Stores content as commits in a GitHub repository;
pairs with the FS adapter for local dev so the same flow works against a real git repo with no FS
required.

## Auth modes

The package supports two authentication shapes. **Pick the one that matches your identity model —
they are not interchangeable.**

### OAuth (user token) — _default for self-hosted gateways and `@laikacms/local`_

Use when the user editing content **is** the GitHub user whose identity will appear on the commits.
This is the right choice for:

- The OSS `laika-gateway` running on someone's own infra, where users sign in with GitHub and the
  gateway acts as them.
- `@laikacms/local` talking directly to a contributor's GitHub repo.
- Any setup where you do **not** have a separate identity provider in front of GitHub.

You provide a user OAuth token (e.g. from the standard `github.com/login/oauth` flow); the
integration calls the GitHub API as that user. No App registration, no private key, no installation
id.

### GitHub App (installation token) — _for divergent identity_

Use only when the user editing content is **not** a GitHub user (for example: they signed in to
Laika Cloud with Google, but the content lives in a GitHub repo). In that case the App's
installation token is what lets the platform write to GitHub on the user's behalf; the user has no
GitHub identity to act under.

Practical signs that you need App mode:

- Laika Cloud–style multi-tenant operator where editors don't have to have GitHub accounts.
- A self-hosted gateway that runs its **own** user database (managed via
  `@laikacms/decap/decap-oauth2` + `@laikacms/decap/decap-api` + `@laikacms/integrations/github`) on
  top of GitHub storage.

Practical signs you do **not** need App mode:

- The user signing in is the user whose name should appear on the commit.
- You don't want to register a GitHub App, manage its private key, or have users install it on their
  repo before they can write.

## Usage — App mode (currently shipping)

```ts
import { GithubStorageRepository } from '@laikacms/github/storage-gh';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { storageSerializerYaml } from 'laikacms/storage-serializers-yaml';

const storage = new GithubStorageRepository({
  // App-mode auth (the App's installation token is minted from the private key)
  appId: env.GITHUB_APP_ID,
  privateKey: env.GITHUB_APP_PRIVATE_KEY,
  installationId: env.GITHUB_APP_INSTALLATION_ID,

  owner: 'esstudio',
  repo: 'content',
  branch: 'main',
  serializerRegistry: {
    yaml: storageSerializerYaml(),
    md: markdownSerializer(),
  },
  defaultFileExtension: 'md',
});
```

Then pass `storage` to `decapApi({ storage, ... })`.

## Usage — OAuth mode (planned; see TODO below)

```ts
import { GithubStorageRepository } from '@laikacms/github/storage-gh';

const storage = new GithubStorageRepository({
  // Async auth provider — invoked on demand, re-invoked on expiry / 401.
  // Return whichever shape matches the user's identity setup.
  auth: async () => ({
    type: 'oauth-user',
    token: await getOAuthTokenForCurrentUser(),
    // Optional; if present, the integration refreshes proactively before this time.
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }),

  owner: 'esstudio',
  repo: 'content',
  branch: 'main',
  serializerRegistry: {/* … */},
  defaultFileExtension: 'md',
});
```

The same `auth` channel is how App mode will be expressed once the refactor lands — App credentials
are just another shape (`type: 'app-installation'`) returned from the callback.

---

## TODO — make this package work without a GitHub App

**Current state.** `GithubDataSourceOptions` requires `appId`, `privateKey`, and `installationId`;
the package can only authenticate as a GitHub App installation. This blocks every OSS scenario where
the user's GitHub identity should be the writer.

**Target shape.** The constructor accepts an **async auth provider** — a callback invoked on demand
to produce credentials, just-in-time. The integration is responsible for caching the returned token
until it expires and re-invoking the callback on expiry or on a 401 from GitHub.

The discriminated union returned by the callback (names and fields below are the design intent — do
**not** copy the `@octokit/auth-app` types verbatim; write a Laika-native shape that hides Octokit
specifics from consumers):

```ts
type LaikaGithubAuth =
  | {
    type: 'oauth-user',
    /** OAuth access token from github.com/login/oauth. */
    token: string,
    /** If present, the cache refreshes proactively before this time. */
    expiresAt?: Date,
    /** Optional refresh hook — invoked instead of the parent callback on expiry. */
    refresh?: () => Promise<LaikaGithubAuth>,
  }
  | {
    type: 'app-installation',
    /** Installation access token. */
    token: string,
    installationId: number | string,
    expiresAt?: Date,
    refresh?: () => Promise<LaikaGithubAuth>,
  }
  | {
    type: 'oauth-app',
    clientId: string,
    clientSecret: string,
  }
  | {
    type: 'pat',
    /** Personal Access Token — supported but discouraged; warn at construction. */
    token: string,
  };

type LaikaGithubAuthProvider = () => Promise<LaikaGithubAuth>;
```

**Caching + expiry.** The integration owns the cache:

- Cache the resolved token by reference identity of the provider callback.
- If `expiresAt` is present, refresh `tokenTtlSeconds` (default 60s) before it. If `expiresAt` is
  absent, do not cache across calls — re-invoke the callback per request.
- If a request returns 401 after a valid cached token, evict and re-invoke the provider exactly
  once. A second 401 surfaces as `AuthenticationError`.
- The async callback is the single source of truth. Do not duplicate token state outside the cache.

**Error mapping.** When the provider throws, or when the underlying GitHub call fails with an
auth-shaped error, surface a Laika-standard error from `@laikacms/core`:

| Cause                                                        | Laika error                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| Provider callback throws / rejects                           | `AuthenticationError`                                       |
| Octokit / fetch returns 401                                  | `AuthenticationError`                                       |
| Octokit returns 403 with auth-permission body                | `AuthorizationError`                                        |
| Octokit returns 403 with `Resource not accessible by …` body | `ForbiddenError`                                            |
| Octokit returns 403 + `x-ratelimit-remaining: 0`             | `TooManyRequestsError`                                      |
| Network / DNS failure during provider callback               | `AuthenticationError`                                       |
| Any other GitHub error                                       | Existing mapping (`NotFoundError` / `InternalError` / etc.) |

Errors include the underlying Octokit status + a short reason in `cause`, never the raw response
body.

**Migration.** Once the callback shape ships, App-mode usage moves to the callback form. The current
`appId` / `privateKey` / `installationId` constructor fields remain accepted **for one minor
version** with a deprecation warning that points at the callback form, then go away.

**Out of scope for the first cut:**

- Building the GitHub OAuth flow itself. That belongs in `@laikacms/decap/decap-oauth2` (and is
  documented there for self-hosted gateways managing their own users).
- Token storage. Where the token lives between requests (cookie, KV, session, CLI keychain) is a
  consumer concern; this package only needs the async callback that returns the current token.
