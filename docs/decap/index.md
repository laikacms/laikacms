# Decap CMS

[Decap CMS](https://decapcms.org/) is the supported editing UI for LaikaCMS. The integration runs in
one direction: **Decap integrates with Laika** — the admin edits through the
[content API](../middleware/api), and any LaikaCMS [backend](../backends/fs) becomes a
Decap-editable content source. You met this in every [quickstart](../getting-started/vite); this
section is the deep material.

## The Laika-enabled Decap build

What you install today is [`@laikacms/decap-cms`](https://www.npmjs.com/package/@laikacms/decap-cms)
— a maintained, single-package build of Decap CMS v4 that ships the `laika` backend alongside
everything upstream Decap does. It keeps the same separation LaikaCMS itself uses — an agnostic core
with opinionated outer layers — and remains completely usable as a standalone CMS without any Laika
packages; it is a general-purpose continuation of Decap CMS, not an admin UI coupled to this
project.

It is developed in its own repository with its own documentation — linked rather than mirrored, so
it can't drift:

- **[Overview & what's different from upstream](https://github.com/laikacms/decap-cms#readme)** —
  the single-package layout, subpath exports, CDN builds, and how it relates to Decap CMS v4.
- **[Skills index](https://github.com/laikacms/decap-cms/blob/main/skills/README.md)** — authored
  guides: driving the decap-api, the Portable Text widget, custom widget development.
- **[Content Security Policy notes](https://github.com/laikacms/decap-cms/blob/main/docs/security/content-security-policy.md)**
  · **[Contributing](https://github.com/laikacms/decap-cms/blob/main/CONTRIBUTING.md)** ·
  **[Changelog](https://github.com/laikacms/decap-cms/blob/main/CHANGELOG.md)**

::: tip Backend vs. admin This section covers wiring the LaikaCMS **backend** that the admin talks
to. The admin UI's own internals (widgets API, editor components, config schema) are documented in
the build's repository above. :::

## In this section

- **[Configuration](./configuration)** — the Decap config, JSON-format collections, catalog
  providers, and typed config codegen.
- **[Authentication](./auth)** — dev tokens, API keys, the OAuth2 server, SSR guards, and the
  multi-tenant hosted gateway.
- **[Serving the admin shell](./admin-shell)** — the esbuild bundle, the CDN builds, and React
  island embedding.
- **[Widgets & editor components](./widgets-and-editors)** — icon widgets and the embedded-entry
  editor component.
- **[Standalone worker](./standalone-worker)** — Decap + Laika with no framework at all.
