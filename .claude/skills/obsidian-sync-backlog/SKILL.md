---
name: obsidian-sync-backlog
description: Where the laikacms issue backlog lives and how to read it. Use whenever a task references WORKLIST.md, Issues/, DECISIONS/, an LCMS-### issue, or a triage step for laikacms.
version: 2.0.0
---

# laikacms Obsidian Backlog

## Where it lives

The laikacms issue backlog lives in the **personal** Obsidian vault:

```
/Users/sempostma/Documents/Obsidian/Vaults/personal/projects/laikacms/
├── WORKLIST.md
├── README.md
├── Issues/       # one .md per LCMS-### issue; frontmatter: id, title, state, triage, priority, deps, labels, branch
└── DECISIONS/
```

An `obsidian://open?vault=personal&file=projects/laikacms/Issues/LCMS-###...` URL maps to
`.../Vaults/personal/projects/laikacms/Issues/LCMS-###...md`.

## Reading it

These are **local files synced by Obsidian Sync**, not iCloud Drive. There is no dataless-eviction
provider in the path, so ordinary reads do **not** hang — read them directly with the `Read` tool or
a plain `cat`/`ls`. No special timeout ceremony is required.

To resolve an issue by number, glob for it rather than guessing the slug:

```
ls "/Users/sempostma/Documents/Obsidian/Vaults/personal/projects/laikacms/Issues/" | grep LCMS-###
```

## If a read ever does stall

Unlikely with Obsidian Sync, but if a read ever hangs, treat the backlog as unreachable for the run
rather than retrying in a loop: do the non-backlog work (GitHub mentions, open PRs, CI, rebases) and
note `Obsidian backlog unreachable` at the end. Don't burn the run retrying the same path.
