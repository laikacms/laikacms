---
title: Hello World
date: 2024-01-01T00:00:00.000Z
description: My first blog post
---

# Hello World

Welcome to my blog, built with **H3**, **Nunjucks**, and **LaikaCMS**.

## What is H3?

H3 is the HTTP toolkit that powers **Nitro** (which in turn powers **Nuxt**). Using it directly —
without Nitro's build tooling — shows the WHATWG-native primitives that the framework builds on top
of:

- `toWebRequest(event)` converts an H3 event to a WHATWG Request
- `sendWebResponse(event, response)` writes a WHATWG Response back
- `serveStatic(event, options)` serves files from the filesystem

## The Laika Proxy Is a Two-Liner

Because H3 is WHATWG-native, the Decap proxy needs no bridging code:

```typescript
const request = toWebRequest(event);
const response = await laika.fetch(request);
return sendWebResponse(event, response);
```

Compare this to Express (4 lines of body buffering) or Koa (15 lines of async iteration).

## Markdown Rendering

This body is rendered to HTML via:

```
remark → remark-rehype → rehype-stringify
```
