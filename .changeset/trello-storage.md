---
"@laikacms/trello": minor
---

New package: `@laikacms/trello`. First export `@laikacms/trello/storage-trello` — a
`StorageRepository` over a single Trello board. Five architectural traits distinguish it from every
prior backend: (1) **floating-point `pos` ordering** — every card carries a positive-float `pos`
field server-assigned by Trello for drag-and-drop ordering. First backend with native positional
ordering at the wire level; (2) **`?key=…&token=…` URL-parameter authentication** — Trello's REST
API authenticates via query parameters, not the `Authorization` header. First backend with
query-string-based auth; (3) **type-specific soft/hard delete** — lists are soft-deleted via
`closed=true` (no physical-delete endpoint exists), cards are physically deletable. First backend
with two different deletion lifecycles per resource type; (4) **2-level platform hierarchy flattened
to N-level paths** — deep paths encode into list names (`notes/sub/deep` → list named `"notes/sub"`
containing card `"deep.md"`); root-level files go to a synthesised `__root__` list. First backend
that flattens an arbitrary tree into a depth-limited platform; (5) **`dateLastActivity` as the
server-managed revision** — Trello updates this on every card mutation; surfaces as
`metadata.revisionId`. First backend using a server-managed change timestamp as the revision. Honest
about what's _not_ here: Trello has no bulk-delete endpoint, so `removeAtoms(N)` does N parallel
`DELETE /1/cards/:id` calls. Runtime-agnostic — only depends on `fetch`.
