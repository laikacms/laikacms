---
title: Hello from Hono RPC
date: 2026-05-31T10:00:00.000Z
---

This starter exposes LaikaCMS via Hono's built-in typed-client (`hc`). The same Hono routes you'd
write anyway double as a typed RPC schema — no separate procedure declarations like tRPC, no SDL
like GraphQL. The client gets every route's input/output shape from `typeof app`.

Same surface as the tRPC and GraphQL starters; different tradeoff: less ceremony, but tied to Hono.
