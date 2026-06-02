---
title: Hello World
date: 2024-01-01T00:00:00.000Z
description: My first blog post
---

# Hello World

Welcome to my blog, built with **Express**, **Handlebars**, and **LaikaCMS**.

## What is Handlebars?

Handlebars is a logic-less template engine for Node.js. Key features:

- **Mustache syntax**: `{{variable}}` for HTML-escaped output, `{{{variable}}}` for raw HTML
- **Built-in helpers**: `{{#if}}`, `{{#each}}`, `{{#unless}}`
- **Layouts**: a shared wrapper that receives rendered views via `{{{body}}}`
- **Partials**: reusable sub-templates via `{{> partialName}}`
- **Custom helpers**: register JavaScript functions for template logic

## Markdown Rendering

This body is stored as Markdown in LaikaCMS and rendered via the remark pipeline:

```
remark → remark-rehype → rehype-stringify
```

In the template, the rendered HTML is output with triple braces — `{{{bodyHtml}}}` — to prevent
Handlebars from double-escaping the HTML entities.
