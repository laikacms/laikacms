---
title: Getting Started with Hexo + LaikaCMS
date: 2024-01-20T12:00:00.000Z
tags:
  - tutorial
  - laikacms
categories:
  - guides
---

This guide walks you through the architecture of the Hexo + LaikaCMS starter.

## Architecture

The starter uses a **Jamstack** pattern:

- **Hexo** (`hexo server --port 4000`) renders your markdown posts into HTML.
- **LaikaCMS admin** (`tsx watch server/admin.ts`) provides a Decap CMS UI on port 3001 for creating
  and editing posts.
- Both processes share the same `source/_posts/` directory. The admin writes markdown files; Hexo's
  watcher picks up changes and rebuilds automatically.

## Content directory mapping

Hexo's content root is `source/`, so the LaikaCMS `contentDir` is set to `source/`. The Decap
`posts` collection maps `folder: "_posts"` — Decap reads and writes `source/_posts/*.md`.

## Adding new posts

Open http://localhost:3001/admin, sign in (dev mode — any credentials work), and click **New Post**.
Hexo will detect the new file and rebuild the blog.

## Deploying

Run `pnpm build` to generate the static site into `public/`. Deploy that directory to any static
host (Netlify, Vercel, GitHub Pages, etc.).

For the production admin you'll need to swap `auth: { mode: 'dev' }` for a real authentication
backend.
