# Guides

Task-oriented walkthroughs for getting LaikaCMS running and wired into your stack.

## Getting up and running

- **[Getting Started](./getting-started)** — install `laikacms`, stand up a JSON:API server, and
  understand the no-auth default.
- **[Deployment](./deployment)** — run the API on Cloudflare Workers or Node.js, add auth and CORS
  as middleware, configure logging, and work through the production security checklist.
- **[Security](./security)** — handling secrets, error hygiene, and production hardening.

## Decap CMS

Pair LaikaCMS with the [Decap CMS](https://decapcms.org/) admin UI. Start with the quickstart, then
reach for the deeper guides as needed.

- **[Decap Integration overview](./decap/)** — the two integration shapes and how the pieces fit.
- **[Self-Hosting Quickstart (FileSystem + Decap)](./decap/quickstart-fs)** — the simplest complete
  self-hosted setup, no cloud account required.
- **[Standalone Worker](./decap/standalone-worker)**, **[Admin shell](./decap/admin-shell)**,
  **[Authentication](./decap/auth)**, **[Widgets & editors](./decap/widgets-and-editors)**,
  **[Framework setup notes](./decap/frameworks)**.
