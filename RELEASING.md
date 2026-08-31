# Releasing

All four public packages (`laikacms`, `@laikacms/server`, `@laikacms/vite-plugin`,
`@laikacms/astro`) are version-fixed via changesets and released together with `changeset publish`.
Publishing MUST go through pnpm (never `npm publish`): pnpm resolves `catalog:` dependency ranges
into the tarball, npm does not — `prepack` guards against this via
`scripts/check-no-pnpm-catalog-deps.mjs`. `changeset publish` is safe here: it detects pnpm from the
root `packageManager` field and runs `pnpm publish` per package. It also skips versions already on
npm, so re-running it (or racing CI) is harmless.

Publishing runs locally via `pnpm release` (see below) — GH Actions billing is org-wide blocked, so
the npm publish step is not automated in CI. Pushing a `v*` tag triggers only
`.github/workflows/create-release.yml`, which creates the matching GitHub release.

## Alpha releases

```sh
pnpm changeset pre enter alpha   # once, at the start of an alpha cycle
pnpm changeset                   # as usual, per change
pnpm changeset version           # bumps to e.g. 1.3.0-alpha.0
git commit -am "chore(release): version packages to 1.3.0-alpha.0"
pnpm release                     # publishes to npm under the alpha dist-tag
git tag v1.3.0-alpha.0
git push origin develop v1.3.0-alpha.0
```

While `.changeset/pre.json` exists (pre mode), `changeset publish` automatically publishes under the
prerelease dist-tag (`alpha`, likewise `beta`/`rc`), so `latest` keeps pointing at the last stable
release. Consumers install with `npm install laikacms@alpha`.

End the alpha cycle with `pnpm changeset pre exit` before versioning the stable release.

## Stable releases

Same flow without pre mode: `pnpm changeset version`, commit, run `pnpm release` to publish, then
tag `vX.Y.Z` and push so the GitHub release is created.

## Publishing from your machine

`pnpm release` runs `changeset publish` locally using your local npm credentials — it publishes
whatever versioned-but-unpublished packages exist, under the correct dist-tag (pre mode aware).
Afterwards, push the `v*` tag so `.github/workflows/create-release.yml` creates the GitHub release.

## SBOM (Software Bill of Materials)

`pnpm gen-sbom` generates a CycloneDX SBOM for each published package (`laikacms`,
`@laikacms/server`, `@laikacms/vite-plugin`, `@laikacms/astro`) via pnpm's built-in `pnpm sbom`
command — no extra dependency needed. Output goes to `sbom/laikacms.cdx.json`,
`sbom/laikacms-server.cdx.json`, `sbom/laikacms-vite-plugin.cdx.json`, and
`sbom/laikacms-astro.cdx.json` (all gitignored — regenerate, don't commit). The script is
`scripts/generate-sbom.mjs`.

This is intentionally a local/publish-time step, not a GitHub Actions workflow step — GH Actions
billing is org-wide blocked (see `AGENTS.md`), so anything load-bearing runs locally. `pnpm release`
runs it automatically before `changeset publish`; run it by hand (`pnpm gen-sbom`) any time you want
a fresh SBOM, e.g. right before cutting a release or for a supply-chain audit.
