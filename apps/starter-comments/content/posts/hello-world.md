---
title: Hello from the comments starter
date: 2026-05-31T10:00:00.000Z
---

POST a comment:

```
curl -X POST http://localhost:3000/comments \
  -H "Content-Type: application/json" \
  -d '{"postSlug":"hello-world","author":"Sem","body":"Great post!"}'
```

It enters the moderation queue. Approve it as the admin to make it appear in
`GET /comments/hello-world`.
