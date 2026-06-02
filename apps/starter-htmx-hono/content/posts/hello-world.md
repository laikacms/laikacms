---
title: Hello from HTMX
date: 2026-05-31T10:00:00.000Z
---

This starter renders HTML on the server with `hono/jsx` and uses HTMX for client interactivity.
There's no React, no Vue, no client-side router — the "refresh posts" button on the home page swaps
in a fresh `<div id="post-list">` fragment via `hx-get="/fragments/posts" hx-target="#post-list"`.

This is the **hypermedia paradigm**: HTML is the application state. The server returns HTML
fragments instead of JSON. HTMX glues them onto the existing page.
