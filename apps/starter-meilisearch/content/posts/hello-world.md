---
title: Hello from Meilisearch
date: 2026-05-31T10:00:00.000Z
---

This post gets indexed in Meilisearch ~5 seconds after the indexer boots. Try
`curl 'http://localhost:3000/search?q=hello'` — you'll get this post back, with highlights on the
title and body.

Edit the post via `/admin`, save, then re-search — the indexer picks up the change on its next poll.
