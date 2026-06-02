---
title: Hello World
date: 2024-01-01T00:00:00.000Z
description: My first blog post
---

# Hello World

Welcome to my blog, built with **Hapi**, **@hapi/vision**, **Nunjucks**, and **LaikaCMS**.

## Hapi's Plugin Architecture

Unlike Express (middleware pipeline) or Fastify (plugin with `fastify.register()`), Hapi uses an
explicit plugin registration model:

```typescript
await server.register([Inert, Vision]);
```

All capabilities — static files (`@hapi/inert`), template rendering (`@hapi/vision`),
authentication, etc. — are opt-in plugins. Nothing is built-in by default.

## @hapi/vision Template Configuration

Views are configured server-wide via `server.views()`, then rendered per-route with
`h.view('template', data)`. This decouples the template engine configuration from individual route
handlers.

## Markdown Rendering

This body is Markdown, rendered to safe HTML via:

```
remark → remark-rehype → rehype-stringify
```

In Nunjucks, pre-rendered HTML is output with `{{ bodyHtml | safe }}`.
