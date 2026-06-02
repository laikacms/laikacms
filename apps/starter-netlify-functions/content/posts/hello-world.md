---
title: Hello from Netlify Functions
date: 2026-05-31T10:00:00.000Z
---

This file lives in the repo. The Netlify Function copies it into `/tmp` at boot — or, in production,
you'd point `createEmbeddedLaika` at a Netlify-Blobs-backed `StorageRepository` (TODO; tracked in
docs/starters.md).

Either way, the function uses the same Hono + `laika.fetch` shape as the Express, Workers, and
Lambda starters.
