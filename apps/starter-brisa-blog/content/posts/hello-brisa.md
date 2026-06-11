---
title: Hello from Brisa + LaikaCMS
date: 2024-01-15T10:00:00.000Z
body: |
  Welcome to your new **Brisa** blog powered by LaikaCMS!

  Brisa is a Bun-based web framework that uses web components for
  client-side interactivity and server components for SSR. This starter
  shows how LaikaCMS integrates with Brisa.

  ## How it works

  - `brisa dev` starts the development server on port 3000
  - Open http://localhost:3000/api/admin to edit content in Decap CMS
  - The blog at http://localhost:3000/ reads from `content/posts/`

  ## Zero-adapter integration

  Brisa's `RequestContext` extends the WHATWG Fetch API `Request` interface,
  so `laika.fetch(req)` works with zero bridging needed.
---
