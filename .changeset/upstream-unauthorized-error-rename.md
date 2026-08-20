---
"laikacms": major
"@laikacms/github": major
"@laikacms/gitlab": major
"@laikacms/bitbucket": major
---

Rename `AuthorizationError` to `UpstreamUnAuthorizedError`, and stop using it for authorization
denials.

The old name promised the wrong thing. `AuthorizationError` reads as "authorization failed", but the
class is HTTP 401 and its actual job is narrow: it is the deserialization target for a 401 challenge
this server received from an _upstream_ — nothing to do with "authenticated but not permitted". That
mismatch was actively misleading people (laikacms#851 proposed routing authorization denials through
it, which would have answered 401 to callers who are in fact authenticated).

The auth vocabulary is now unambiguous:

| Case                                            | Error                       | Status |
| ----------------------------------------------- | --------------------------- | ------ |
| Caller has not proven who they are              | `AuthenticationError`       | 401    |
| Caller is authenticated but not permitted       | `ForbiddenError`            | 403    |
| An upstream rejected _this server's_ credential | `UpstreamUnAuthorizedError` | 401    |

The wire code is unchanged (`unauthorized`), so JSON:API error payloads and the proxy's
`rehydrateErrorCodes` round-trip are unaffected. The exported `errorCode`/`errorStatus` key moved
from `AUTHORIZATION_ERROR` to `UPSTREAM_UNAUTHORIZED`.

Two mapping bugs surfaced by the rename are fixed as part of it:

- **GitHub 403 returned 401.** `GithubDataSource.mapError` mapped a GitHub `403` to the 401 class,
  so a permission denial told callers to re-authenticate when their token was valid but
  under-scoped. It now returns `ForbiddenError` (403), matching the GitLab and Bitbucket
  datasources.
- **Upstream 401s claimed the caller was unauthenticated.** All three git-host datasources mapped an
  upstream `401` to `AuthenticationError`, which means "_this_ server rejected your credential". A
  git host rejecting the server's own token is a different failure, and now returns
  `UpstreamUnAuthorizedError`. Status is unchanged (both are 401); only the error code and message
  change.
