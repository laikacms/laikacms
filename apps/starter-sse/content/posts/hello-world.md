---
title: Hello from SSE
date: 2026-05-31T10:00:00.000Z
---

Open the home page (`http://localhost:3000`) and watch the event log. Then edit this post via
`/admin`. Within ~2 seconds you'll see a `changed` event appear in the log — that's the SSE channel
telling clients the content has changed.

The change detection here is a 2-second poll on top of the documents repo. ADR-001 in the repo
proposes a native LaikaCMS pub/sub channel; once that lands, this starter can swap polling for a
real subscription with no other changes.
