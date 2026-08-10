---
'@laikacms/server': major
'laikacms': patch
---

Rename `@laikacms/decap` to `@laikacms/server` and drop the `decap-` prefix from its modules.

Neither module was ever Decap-specific: `decap-api` is a composition router over the `laikacms`
JSON:API sub-APIs behind one auth boundary, and `decap-oauth2` is a self-contained OAuth 2.0
authorization server that does not need the CMS API to exist. Only the naming implied otherwise.

**Subpaths**

| Before                                      | After                                  |
| ------------------------------------------- | -------------------------------------- |
| `@laikacms/decap/decap-api`                 | `@laikacms/server/api`                 |
| `@laikacms/decap/decap-oauth2`              | `@laikacms/server/oauth2`              |
| `@laikacms/decap/decap-oauth2/i18n`         | `@laikacms/server/oauth2/i18n`         |
| `@laikacms/decap/decap-oauth2/i18n/{en,nl}` | `@laikacms/server/oauth2/i18n/{en,nl}` |
| `@laikacms/decap/decap-cms-backend-laika`   | `@laikacms/decap-cms/backends/laika`   |

**Symbols**: `decapApi` -> `laikaApi`, `DecapApi` -> `LaikaApi`, `DecapOptions` ->
`LaikaApiOptions`, `decapOauth2` -> `laikaOauth2`, `DecapOauth2` -> `LaikaOauth2`. The
module-augmentation targets moved with the subpaths (`declare module '@laikacms/server/api'`).

There are no compatibility aliases; `@laikacms/decap` is deprecated on npm.

**The Decap CMS backend left this package entirely.** `createLaikaBackend()` /
`resolveLaikaBackend()` now ship only with the fork, as `@laikacms/decap-cms/backends/laika`. The
copy here had drifted behind the fork's, so it was deleted rather than merged. As a result
`@laikacms/server` no longer has `react` or `@laikacms/decap-cms` peer dependencies, and its only
runtime dependency is `laikacms`.

**User-visible defaults rebranded from "Decap CMS" to "Laika CMS":** login page titles
(`oauth2/i18n` en + nl), the transactional-email `appName`, and the TOTP `issuer`
(`DEFAULT_TOTP_ISSUER`, now exported from `@laikacms/server/oauth2`).

The TOTP change needs action if you have enrolled users. The issuer is the label in the
authenticator app and is baked into every already-minted `otpauth://` URI, so a deployment that
relied on the old default must now set it explicitly to keep existing enrollments matching:

```ts
laikaOauth2({
  // …
  totp: { enabled: true, issuer: 'Decap CMS', callbacks },
});
```

Deployments with no enrolled users, or that already set `totp.issuer`, are unaffected.
