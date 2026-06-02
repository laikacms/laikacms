---
title: Hello from Fastify
date: 2026-05-31T10:00:00.000Z
---

LaikaCMS speaks web-standard `Request` / `Response`. Fastify wraps Node's `req` / `res` like Express
does, so we use a similar adapter — but here, the adapter is wired through Fastify's
`addContentTypeParser('*')` hook, which skips body parsing globally and lets us stream the raw body
to `laika.fetch()`.
