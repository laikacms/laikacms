---
"laikacms": minor
"@laikacms/server": minor
---

Support Node 22. The oauth2 safety gate no longer uses the Node version as a stand-in for feature
detection, and `engines` drops from `>=24.0.0` to `>=22.0.0` on both packages.

`LCMS_OAUTH2_NODE_UNSUPPORTED` fired below Node 24 on the stated grounds that such releases "lack
the global Web Crypto API and no longer receive upstream security fixes". Neither holds for Node 22:
global Web Crypto has been present since Node 19, and Node 22 is in LTS maintenance until
2027-04-30. Nothing in the package required Node 24 either — `oauth2` imports no `node:*` builtins
at all (it is bundled for Workers, Deno and Bun), the whole tree compiles to `ES2022`, and the
heaviest runtime dependency, `@effect/platform-node`, asks only for `>=18`. The floor was the repo's
own dev-tooling pin propagated into a published constraint, and it refused a runtime that could in
fact uphold every guarantee the package makes.

Capability is now decided only by the probes that already existed and test the real thing:
`LCMS_OAUTH2_CSPRNG_MISSING`, `LCMS_OAUTH2_WEBCRYPTO_SUBTLE_MISSING`,
`LCMS_OAUTH2_CSPRNG_DEGENERATE`, `LCMS_OAUTH2_SHA256_UNAVAILABLE`, `LCMS_OAUTH2_HMAC_UNAVAILABLE`
and `LCMS_OAUTH2_PASSKEY_ES256_UNAVAILABLE`. These catch a shimmed or crippled runtime whatever
version it reports, and clear a capable one a version comparison would have rejected.

`LCMS_OAUTH2_NODE_UNSUPPORTED` is kept — reason codes are permanent — but now means only what a
capability probe cannot determine: **the runtime is past end-of-life and receives no security
patches.** The floor is 22 because Node 21 (EOL 2024-06-01) and Node 20 (EOL 2026-04-30) no longer
get security fixes, and no probe can detect that from inside the process. It stays `ignorable`.
Raise the floor when the floor line reaches EOL, not when a new LTS ships.

Consumers pinned to Node 24 are unaffected. The full `@laikacms/server` (502) and `laikacms` (2014)
suites pass on Node 22.
