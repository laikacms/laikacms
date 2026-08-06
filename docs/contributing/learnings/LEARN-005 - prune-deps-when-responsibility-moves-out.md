---
id: LEARN-005
title: Prune dependencies when a responsibility moves out behind an interface
source: distilled from the 2026-08-05 decap unused-JWT-deps cleanup
date: 2026-08-06
---

# Prune deps when a responsibility moves out

`packages/decap` still declared `aws-jwt-verify`, `jsonwebtoken`, `jwt-decode`, and
`@types/jsonwebtoken` long after they had any caller — a full grep of `src` (incl. tests) found
**zero** references. Removing them pruned **16** packages with the build and 514 tests still green.

## Why they lingered

They were added when `decap` verified tokens itself. The breaking change
`feat(decap)!: split authentication from authorization` (67ffc311) inverted that: `decap-api` now
delegates _all_ token handling to caller-supplied callbacks (`authenticateAccessToken` /
`authenticateApiToken`). The responsibility left the package, but the manifest didn't follow — the
classic residue of a clean refactor.

## The lesson

When a responsibility moves out **behind an injected callback/interface**, the code that used its
libraries disappears silently — TypeScript won't flag an unused _dependency_, only an unused
_import_. So the manifest rots without a compiler error.

Make it a step of any "extract / invert to a callback" refactor:

1. `grep -rn` the package `src` for each dependency the moved code used.
2. Drop the ones with zero hits (and their `@types/*`).
3. Re-install and run the build + tests to confirm nothing implicit relied on them.

Cheap, and it keeps install/build/CI surface honest. Relates to [[monorepo-restructure-2026-06]]
(the same instinct at repo scale) and [[LEARN-004 - library-interface-is-the-product]] — a manifest
that lists libraries it no longer uses is another quiet form of the published shape misrepresenting
what it is.
