---
title: Hello World
date: 2024-01-01T00:00:00.000Z
description: My first blog post
---

# Hello World

Welcome to my blog, built with **Koa**, **LiquidJS**, and **LaikaCMS**.

## What is Liquid?

Liquid is a template language created by Shopify. It powers:

- Shopify storefronts
- GitHub Pages
- Jekyll static sites
- Eleventy (11ty) sites

## Key Differences from Jinja2 / Nunjucks

LiquidJS (the Node.js implementation) does **not** auto-escape HTML by default. Unlike Jinja2 or
Nunjucks — where `{{ variable }}` escapes HTML entities — LiquidJS outputs values as-is. This means
`{{ bodyHtml }}` correctly renders pre-processed Markdown HTML without double-escaping.

## Markdown Rendering

This body is stored as Markdown in LaikaCMS and rendered via:

```
remark → remark-rehype → rehype-stringify
```

The remark pipeline sanitizes all HTML (no XSS), and LiquidJS outputs the result unescaped.
