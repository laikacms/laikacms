# Learnings

Distilled, durable lessons — the backward-looking sibling of [ADRs](../adrs/README.md): ADRs record
forward-looking choices; learnings record what we got wrong (or nearly did) and the rule that came
out of it.

Notes only — the verbose sources live in git history and the design records.

| ID                                                                         | Title                                                                     | Source                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| [LEARN-004](./LEARN-004%20-%20library-interface-is-the-product.md)         | As a library, the interface is the product — hold it to a higher standard | 2026-08-05 locks-redesign session (ADR-007) |
| [LEARN-005](./LEARN-005%20-%20prune-deps-when-responsibility-moves-out.md) | Prune dependencies when a responsibility moves out behind an interface    | 2026-08-05 decap unused-deps cleanup        |
| [LEARN-006](./LEARN-006%20-%20dont-leak-private-locations.md)              | Don't leak private locations into shared or public artifacts              | 2026-08-06 publishing session               |

> LEARN-001–003 concern security bug-classes, testing philosophy, and the monorepo restructure; they
> are kept in the private log rather than on this public site.
