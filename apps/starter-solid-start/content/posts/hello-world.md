---
title: Hello from SolidStart
date: 2026-05-31T10:00:00.000Z
---

This starter uses **SolidStart** — Solid's full-stack framework. Data loading goes through
`query(...)` + `createAsync(...)`: the inner function carries a `'use server'` directive, so it
executes on the server during SSR and the result is serialized into the HTML for the client to
resume.

Same pattern as the other SSR starters, expressed in SolidStart's idiom.
