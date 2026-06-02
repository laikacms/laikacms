---
title: Hello from Fly.io
date: 2026-05-31T10:00:00.000Z
---

This file ships in the repo and gets baked into the container image. On first deploy, Fly's volume
at `/data` is empty — the embedded preset auto-copies seed content if you symlink `content/` into
the image (see Dockerfile).

For real content, edit at `/admin` in production — writes land on the Fly volume mounted at
`/data/content`.
