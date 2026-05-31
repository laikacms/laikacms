---
title: Hello from Express
date: 2026-05-31T10:00:00.000Z
---

LaikaCMS speaks web-standard `Request` / `Response`. Express speaks Node.js `req` / `res`. This
starter bridges them with a small, dependency-free adapter in `src/lib/express-fetch-adapter.ts` —
so the same `laika.fetch()` handler that powers the Bun, Hono, and Workers starters runs unchanged
inside an Express app.
