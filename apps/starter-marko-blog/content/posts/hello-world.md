---
title: Hello from Marko
date: 2026-05-31T10:00:00.000Z
---

This starter uses **Marko** — eBay's tag-based UI language with streaming, out-of-order SSR. The
`.marko` template syntax is whitespace-significant and compiles to extremely small client bundles
(resumable, like Qwik, but with a different runtime story).

The route `src/routes/+page.marko` `await`s `listPosts()` at the top — Marko streams the surrounding
chrome immediately and patches in the post list when the promise resolves.
