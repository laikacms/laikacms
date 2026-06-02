---
title: Hello from WebSockets
date: 2026-05-31T10:00:00.000Z
---

Open the home page and edit this post via `/admin`. A `changed` event arrives over the WebSocket
within ~2 seconds. The channel is bidirectional, so you can also send messages from the page — the
server echoes them back.

Same underlying change-detection as the SSE starter (polling on top of `listRecords`); the
difference is the wire protocol and the bidirectional client→server channel.
