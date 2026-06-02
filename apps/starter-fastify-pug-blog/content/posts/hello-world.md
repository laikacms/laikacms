---
title: Hello World
date: 2024-01-01T00:00:00.000Z
description: My first blog post
---

# Hello World

Welcome to my blog, built with **Fastify**, **Pug**, and **LaikaCMS**.

## What is Pug?

Pug (formerly Jade) is a concise, whitespace-sensitive template engine for Node.js. It features:

- Template inheritance via `extends` / `block`
- Mixins for reusable components
- Inline JavaScript expressions
- Clean, minimal syntax without closing tags

## Markdown Rendering

This post body is stored as Markdown in LaikaCMS and rendered to HTML via the `remark` pipeline:

```
remark → remark-rehype → rehype-stringify
```

All HTML in the Markdown is escaped for safety — no XSS vectors.
