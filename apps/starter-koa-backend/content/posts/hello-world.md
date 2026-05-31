---
title: Hello from Koa
date: 2026-05-31T10:00:00.000Z
---

Koa is the spiritual successor to Express, written by the original Express team. It has a minimal
core (~600 LOC) and middleware-as-async-functions — which actually makes the web-standard adapter
shorter than the Express version, because `ctx.body = nodeStream` does the streaming for you.

LaikaCMS works the same way regardless of which Node framework you pick.
