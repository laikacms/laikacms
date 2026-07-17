# Releasing

All three public packages (`laikacms`, `@laikacms/decap`, `@laikacms/decap-ai`) are version-fixed
via changesets and released together. Publishing MUST go through pnpm (never `npm publish`): pnpm
resolves `catalog:` dependency ranges into the tarball, npm does not — `prepack` guards against this
via `scripts/check-no-catalog-deps.mjs`.

Pushing a `v*` tag triggers `.github/workflows/publish.yml`, which lints, typechecks, tests, builds,
and runs `pnpm -r publish` using npm OIDC trusted publishing (no token secret; each package must
have this repo + `publish.yml` configured as a Trusted Publisher on npmjs.com).
`.github/workflows/create-release.yml` creates the matching GitHub release.

## Alpha releases

```sh
pnpm changeset pre enter alpha   # once, at the start of an alpha cycle
pnpm changeset                   # as usual, per change
pnpm changeset version           # bumps to e.g. 1.3.0-alpha.0
git commit -am "chore(release): version packages to 1.3.0-alpha.0"
git tag v1.3.0-alpha.0
git push origin develop v1.3.0-alpha.0
```

The workflow derives the npm dist-tag from the tag name: `v1.3.0-alpha.0` publishes under the
`alpha` dist-tag (likewise `beta`/`rc`), so `latest` keeps pointing at the last stable release.
Consumers install with `npm install laikacms@alpha`.

End the alpha cycle with `pnpm changeset pre exit` before versioning the stable release.

## Stable releases

Same flow without pre mode: `pnpm changeset version`, commit, tag `vX.Y.Z`, push. The workflow
publishes under `latest`.

## Publishing from your machine

CI is the normal path. As a fallback, `pnpm release` (stable) or `pnpm release:alpha` publishes the
workspace from the `develop` branch using your local npm credentials.
