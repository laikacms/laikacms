---
title: Hello from Bun
date: 2026-05-31T10:00:00.000Z
---

This starter runs the exact same `createEmbeddedLaika` setup as `apps/starter-hono-backend` — but on
the **Bun runtime** instead of Node.js, served by the native `Bun.serve()` API. No Hono, no
`@hono/node-server`, no `tsx` — Bun handles TypeScript and the web-standard `fetch` handler
directly.

The point of this starter: prove that the LaikaCMS embedded preset is runtime-portable. The same
module powers Node.js, Bun, and (with the `/workers` preset) Cloudflare Workers.
