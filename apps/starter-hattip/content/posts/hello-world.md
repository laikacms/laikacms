---
title: Hello from Hattip
date: 2026-05-31T10:00:00.000Z
---

Hattip's pitch: write one `(context) => Response` handler, then deploy it to any runtime by swapping
a single adapter import. `src/handler.ts` is the handler. `src/node-entry.ts` is the Node adapter
wiring. Replace that with `@hattip/adapter-bun`, `@hattip/adapter-cloudflare-workers`,
`@hattip/adapter-aws-lambda`, etc. — the handler doesn't change.

For LaikaCMS this matters because it removes "which runtime?" from the decision tree. Build once,
decide where to host later.
