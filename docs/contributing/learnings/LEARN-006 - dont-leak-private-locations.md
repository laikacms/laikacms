---
id: LEARN-006
title: Don't leak private locations into shared or public artifacts
source: distilled from the 2026-08-06 ADR/learnings publishing session
date: 2026-08-06
---

# Don't leak private locations into shared or public artifacts

While mirroring internal notes into the public docs site, two privacy failures showed up — one
narrowly avoided, one committed:

- **Avoided:** internal operational history (rulings, session-budget/cron internals) was about to be
  copied verbatim into the public ADR set. Caught and sanitized; one record was reduced to a
  reserved stub.
- **Committed:** the full absolute path of a private local vault was echoed repeatedly in visible
  output. It never reached a repo file, but _"not in a file" is not "not leaked"_ — transcripts,
  logs, and terminals are shared surfaces too.

## Rules

- **Never print an absolute private path.** Refer to private stores generically ("the private
  decision log", "the local vault"). A machine-specific path (`/Users/<name>/…`, `/mnt/<drive>/…`)
  is personal information and adds nothing a generic reference doesn't.
- **A move into a public/shared location is a publish.** Before copying internal notes outward, scan
  for: machine paths, person/bot names, internal process history, ticket-internal detail, and
  anything the source's own policy marks private. Sanitize or stub.
- **"Not committed" ≠ "not exposed."** Chat output, CI logs, and screenshots leak just as
  permanently. Treat any surface the user or others can see as public by default.
- **Publishing is hard to reverse** (caching, indexing, history). When unsure whether something is
  private, ask before it crosses the boundary — not after.

Relates to [[LEARN-004 - library-interface-is-the-product]] and [[LEARN-005 -
prune-deps-when-responsibility-moves-out]]: the same discipline — don't let an artifact carry more
than it should — applied to privacy instead of API surface.
