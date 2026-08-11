---
name: laikacms-docs
description: >-
  Find and read the laikacms documentation that matches the exact version
  installed in the current project. Use whenever the user asks how to do
  something with laikacms, references a laikacms export/API/error/package
  (buildJsonApi, laikaApi, a storage repository or serializer, a LaikaError),
  or needs version-accurate guides, concepts, or JSON:API reference instead of
  guessing from memory.
license: MIT
---

# laikacms docs

laikacms ships no docs inside its npm package — they live in the `laikacms/laikacms` GitHub repo
under `docs/`, and they change between versions. Do **not** answer laikacms questions from memory.
Instead, resolve the docs for the version the project actually has installed, then read only the
page(s) you need.

A bundled zero-dependency Node script does the version detection, ref resolution, and listing. Run
it from the **project root** (so it can read that project's `node_modules`).

## Workflow

1. **List the docs tree for the installed version:**

   ```bash
   node <skill-dir>/scripts/laika-docs.mjs index
   ```

   `<skill-dir>` is wherever this skill was installed — typically `.claude/skills/laikacms-docs`.
   The output shows the installed version, the resolved git ref (and whether it is version-pinned),
   a "Start here" list of orientation docs, and the full docs tree grouped by section.

2. **Read the specific page(s)** the task needs — pass the `docs/...` path:

   ```bash
   node <skill-dir>/scripts/laika-docs.mjs get docs/getting-started/nodejs.md
   ```

   Prefer reading one or two targeted pages over dumping the whole tree into context. Good entry
   points: `docs/index.md`, `docs/getting-started/nodejs.md`, `docs/reference/packages.md`, and the
   section index files.

3. **Answer from what you read**, citing the doc path. If the ref was not version-pinned (see
   below), tell the user the docs may be newer than their installed version.

## How the version is resolved (anchor ladder)

The script picks the most precise ref it can, in this order:

1. `gitHead` in the installed `package.json` — exact commit the package was built from.
2. Git tag `laikacms@<version>` — exact release (only if that tag is pushed to GitHub).
3. The repo's default branch — always works, but is "latest" and may be ahead of the installed
   version. The script prints a ⚠ warning when it falls back here.

`resolve` shows just the version + ref without listing:

```bash
node <skill-dir>/scripts/laika-docs.mjs resolve
```

Add `--json` to `index` / `resolve` for machine-readable output (paths, groups, `browseUrl`,
`rawUrlTemplate`).

## Notes

- Needs network access to `api.github.com` (falls back to the jsDelivr CDN if the GitHub API is
  rate-limited). Set `GITHUB_TOKEN` to raise the API limit from 60 to 5000 requests/hour.
- If laikacms is not installed in the project, the script still works and shows the latest docs from
  the default branch.
