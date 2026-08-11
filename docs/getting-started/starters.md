# Starters

Download-and-go templates. Each starter is a small, self-contained blog showing one way LaikaCMS is
wired into a framework, runtime, or storage backend — and each one is a **live example**: the
StackBlitz links open a running copy in your browser.

**Always create apps through the wizard**, not by copying a folder — it generates `src/cms.ts` from
your backend/widget/locale selection:

```sh
npx laikacli create --starter <name>
```

See [`laika create`](../cli/create) for every flag.

## The starters

| Starter                                                                                                                                                                                                                         | Stack                                       | Demonstrates                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`starter-vite-react-blog`](https://github.com/laikacms/laikacms/tree/develop/starters/starter-vite-react-blog) · [StackBlitz ↗](https://stackblitz.com/github/laikacms/laikacms/tree/develop/starters/starter-vite-react-blog) | Vite SSR + React + Express                  | No meta-framework — the server-side rendering, request handling, and Decap proxy that Next.js abstracts away. The [Vite quickstart](./vite)'s template.                                 |
| [`starter-opfs-blog`](https://github.com/laikacms/laikacms/tree/develop/starters/starter-opfs-blog) · [StackBlitz ↗](https://stackblitz.com/github/laikacms/laikacms/tree/develop/starters/starter-opfs-blog)                   | Browser-only                                | **LaikaCMS entirely in the browser** — no server, no database. Content in [OPFS](../backends/opfs) or a user-picked local folder. The one-click demo.                                   |
| [`starter-hono-blog`](https://github.com/laikacms/laikacms/tree/develop/starters/starter-hono-blog) · [StackBlitz ↗](https://stackblitz.com/github/laikacms/laikacms/tree/develop/starters/starter-hono-blog)                   | Hono + Node.js                              | `createEmbeddedLaika`, SSR blog routes, in-process document reads via `laikacms/compat`. The [Node.js quickstart](./nodejs)'s template.                                                 |
| [`starter-astro-blog`](https://github.com/laikacms/laikacms/tree/develop/starters/starter-astro-blog) · [StackBlitz ↗](https://stackblitz.com/github/laikacms/laikacms/tree/develop/starters/starter-astro-blog)                | Astro (static)                              | Build-time content via `@laikacms/vite-plugin` (`laika:` imports), with the dev-only local JSON:API (`localApi: true`) powering the admin during `astro dev`.                           |
| [`starter-github-blog`](https://github.com/laikacms/laikacms/tree/develop/starters/starter-github-blog)                                                                                                                         | Hono + [GitHub backend](../backends/github) | Content stored directly in a GitHub repo via a GitHub App — every publish is a commit. (Needs GitHub App credentials, so no one-click StackBlitz.)                                      |
| [`starter-workers-blog`](https://github.com/laikacms/laikacms/tree/develop/starters/starter-workers-blog)                                                                                                                       | Cloudflare Workers + D1                     | Lower-level `laikaApi` wiring for edge runtimes where `createEmbeddedLaika` isn't available. The [Workers quickstart](./cloudflare-workers)'s template. (Needs Cloudflare credentials.) |

Every starter boots the **bare** Decap app (`@laikacms/decap-cms/laika-app/bare`) and registers only
the backends, widgets, and locales listed in its generated `src/cms.ts` — the admin bundle contains
exactly what the site uses.

> This is a curated set. Around 135 more reference apps (one per framework × backend combination)
> exist outside the monorepo and will be migrated back as demand warrants — if you're missing one,
> [open an issue](https://github.com/laikacms/laikacms/issues).
