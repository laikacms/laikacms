---
title: Hello from Vue + Vite
date: 2026-05-31T10:00:00.000Z
---

This starter is the **only pure-client** starter so far. Pages are rendered by Vue in the browser;
the home view calls `fetch('/api/posts')` on mount.

The Vite dev server proxies `/api/*` and `/admin` to the sidecar Hono backend on port 3001 — so the
developer experience feels single-origin even though two processes are running.
