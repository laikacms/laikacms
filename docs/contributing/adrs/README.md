# Architecture Decision Records

ADRs are recorded here as they come in. Each decision document captures the context, options
considered, decision made, and consequences.

Filename pattern: `ADR-NNN - kebab-title.md`

## Decision Records

| ID                                                                            | Title                                                                                       | Status   | Date       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- | ---------- |
| [ADR-001](./ADR-001%20-%20realtime-collaboration.md)                          | Real-time Collaboration Architecture                                                        | accepted | 2026-05-20 |
| [ADR-002](./ADR-002%20-%20graphql-api-option.md)                              | GraphQL API Option                                                                          | rejected | 2026-05-20 |
| [ADR-003](./ADR-003%20-%20repository-effect-boundary-convention.md)           | Repository Effect boundary convention (LaikaTask target style)                              | accepted | 2026-07-04 |
| [ADR-003](./ADR-003%20-%20storage-depth-traversal-shared-helper.md)           | Depth traversal for listAtoms/listAtomSummaries belongs in a shared helper                  | accepted | 2026-06-17 |
| [ADR-004](./ADR-004%20-%20documents-api-batch-operations-semantics.md)        | documents-api POST /operations — fail-fast batch semantics                                  | accepted | 2026-07-12 |
| [ADR-005](./ADR-005%20-%20fleet-session-budget.md)                            | (reserved — internal)                                                                       | internal | 2026-07-14 |
| [ADR-006](./ADR-006%20-%20cms-agnostic-protocol.md)                           | The protocol stays CMS-agnostic; every CMS integrates via an opinionated adapter            | accepted | 2026-07-16 |
| [ADR-007](./ADR-007%20-%20document-locking-and-write-preconditions.md)        | Document locking & write preconditions — repository-native, Effect, capability-graded       | accepted | 2026-08-05 |
| [ADR-008](./ADR-008%20-%20ssr-content-access-rejects-the-laika-chunk-shim.md) | SSR content access — `laika:` stays build-time; server consumers call repositories directly | proposed | 2026-08-10 |

> **Note:** ADR-003 is a duplicated number in the source log (two distinct decisions). Pending a
> renumber to resolve the collision.
