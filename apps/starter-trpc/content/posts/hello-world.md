---
title: Hello from tRPC
date: 2026-05-31T10:00:00.000Z
---

This starter wraps LaikaCMS as a **tRPC v11** router. Same shape as the GraphQL starter —
`posts.list`, `posts.get`, `posts.createDraft`, `posts.publish` — but expressed as type-safe RPC
instead of a schema.

The client imports `AppRouter` from `src/router.ts` and gets full IDE autocomplete for every
procedure, input, and return type. No code generation step.
