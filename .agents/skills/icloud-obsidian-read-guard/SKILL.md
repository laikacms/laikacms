---
name: icloud-obsidian-read-guard
description: Use whenever reading the laikacms Obsidian backlog (WORKLIST.md, Issues/, DECISIONS/) or anything under /Users/sempostma/Documents — those paths are iCloud-synced and can hang the run forever.
version: 1.0.0
---

# iCloud / Obsidian Read Guard

## Overview

For laikacms the issue backlog lives in Obsidian under
`/Users/sempostma/Documents/personal/Projects/laikacms/` (`WORKLIST.md`, `Issues/`,
`DECISIONS/`). That tree is **iCloud-synced**. When iCloud Drive on the host is logged out
or a file is evicted (dataless), any `ls`/read of it **blocks indefinitely** — the kernel
waits for an iCloud provider that never answers. The agent then produces no output and is
killed at 600s with zero work done. This has killed 4+ consecutive worker runs and reviewer
runs, burning ~10 min of compute each for nothing.

Diagnostic signature: run status `error`, message
`FailoverError: CLI produced no output for 600s and was terminated.`
Confirm root cause with `brctl download <path>` — if it returns
`Logged out - iCloud Drive is not configured`, iCloud is the cause.

## Rule

**Never read an iCloud/Documents path with an unbounded call.** Always bound it.

- Set the **Bash tool `timeout` parameter** to ~10000 ms on any command that touches
  `/Users/sempostma/Documents/...`. Do **not** rely on a shell `timeout` binary — macOS
  has none (exit 127).
- The `Read` tool can also hang on a dataless file. Prefer a guarded
  `cat`/`ls` via the Bash tool (bounded timeout) to probe reachability first.

## On timeout — fail fast, don't loop

If an Obsidian read times out, treat the backlog as **UNREACHABLE** for this run:

1. Do **not** retry the same read in a loop (that just burns the whole run).
2. Skip backlog-dependent work (picking new issues from WORKLIST/Issues).
3. Still do the work that does **not** need Obsidian: address GitHub `@`-mentions,
   open-PR tasks, CI, rebases.
4. End the run noting `Obsidian/iCloud unreachable` so the optimizer/operator can see it.

## Host fix (not the agent's job)

The durable fix is host-level: sign iCloud Drive back in (or move the vault out of the
iCloud-evicting path). Agents can only fail gracefully — flag it, don't hang.
