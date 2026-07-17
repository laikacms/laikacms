# Releasing

All three public packages (`laikacms`, `@laikacms/decap`, `@laikacms/decap-ai`) are version-fixed
via changesets and released together with `changeset publish`. Publishing MUST go through pnpm
(never `npm publish`): pnpm resolves `catalog:` dependency ranges into the tarball, npm does not —
`prepack` guards against this via `scripts/check-no-catalog-deps.mjs`. `changeset publish` is safe
here: it detects pnpm from the root `packageManager` field and runs `pnpm publish` per package. It
also skips versions already on npm, so re-running it (or racing CI) is harmless.

Pushing a `v*` tag triggers `.github/workflows/publish.yml`, which lints, typechecks, tests, builds,
and runs `pnpm changeset publish` using npm OIDC trusted publishing (no token secret; each package
must have this repo + `publish.yml` configured as a Trusted Publisher on npmjs.com).
`.github/workflows/create-release.yml` creates the matching GitHub release. The per-package git tags
`changeset publish` creates (`laikacms@X.Y.Z`, …) stay local to the CI runner; the manually pushed
`v*` tag is the release marker.

## Alpha releases

```sh
pnpm changeset pre enter alpha   # once, at the start of an alpha cycle
pnpm changeset                   # as usual, per change
pnpm changeset version           # bumps to e.g. 1.3.0-alpha.0
git commit -am "chore(release): version packages to 1.3.0-alpha.0"
git tag v1.3.0-alpha.0
git push origin develop v1.3.0-alpha.0
```

While `.changeset/pre.json` exists (pre mode), `changeset publish` automatically publishes under the
prerelease dist-tag (`alpha`, likewise `beta`/`rc`), so `latest` keeps pointing at the last stable
release. Consumers install with `npm install laikacms@alpha`.

End the alpha cycle with `pnpm changeset pre exit` before versioning the stable release.

## Stable releases

Same flow without pre mode: `pnpm changeset version`, commit, tag `vX.Y.Z`, push. The workflow
publishes under `latest`.

## Publishing from your machine

CI is the normal path. As a fallback, `pnpm release` runs `changeset publish` locally using your
local npm credentials — it publishes whatever versioned-but-unpublished packages exist, under the
correct dist-tag (pre mode aware). Afterwards, still push the `v*` tag so the GitHub release is
created; the publish workflow it triggers is a no-op for already-published versions.
