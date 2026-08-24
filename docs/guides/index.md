# Guides

Task-oriented walkthroughs for getting LaikaCMS running and wired into your stack.

## Getting up and running

- **[Getting Started](./getting-started)** — the progressive path: read/write content in the
  browser, stand up a secure-by-default server, or compile content at build time for a static site.
- **[Deployment](./deployment)** — run the API on Cloudflare Workers or Node.js, add auth and CORS
  as middleware, configure logging, and work through the production security checklist.
- **[Security](./security)** — handling secrets, error hygiene, and production hardening.
- **[Advanced: raw Storage API](./advanced/raw-storage-api)** — the low-level `buildJsonApi`
  primitive with no built-in auth. You secure it yourself; most projects want `laikaApi` instead.

## Astro

Use LaikaCMS content in Astro pages through Astro's own Content Layer — `getCollection`, `getEntry`,
`render`, Zod schemas — with incremental sync and dev-server hot-reload.

- **[`@laikacms/astro` reference](/reference/packages/astro/)** — loaders, the `laika()`
  integration, live collections, and Zod schema derivation.

## Decap CMS

Pair LaikaCMS with the [Decap CMS](https://decapcms.org/) admin UI. Start with the quickstart, then
reach for the deeper guides as needed.

- **[Decap Integration overview](./decap/)** — the two integration shapes and how the pieces fit.
- **[Self-Hosting Quickstart (FileSystem + Decap)](./decap/quickstart-fs)** — the simplest complete
  self-hosted setup, no cloud account required.
- **[Standalone Worker](./decap/standalone-worker)**, **[Admin shell](./decap/admin-shell)**,
  **[Authentication](./decap/auth)**, **[Widgets & editors](./decap/widgets-and-editors)**,
  **[Framework setup notes](./decap/frameworks)**.
