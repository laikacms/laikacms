---
title: Hello from Render.com
date: 2026-05-31T10:00:00.000Z
---

This file ships in the container image. On Render, the persistent disk at `/var/laikacms` is
initially empty — content written via Decap admin lands there and survives deploys.

Render's free tier sleeps the service after 15 minutes of inactivity. First request after a sleep
takes ~30 seconds to cold-start. Upgrade to a paid plan to keep it warm.
