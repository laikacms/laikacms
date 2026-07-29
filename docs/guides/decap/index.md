# Decap CMS Integration

[Decap CMS](https://decapcms.org/) is a Git-based admin UI for content. LaikaCMS ships a
Decap-compatible backend (`@laikacms/decap`) so you can pair that admin with any LaikaCMS storage
repository — filesystem, R2, S3, WebDAV, and more.

Two integration shapes are supported, in increasing order of complexity:

| Pattern                                                  | When to use                                            | Backend host                                                                           | Auth                             |
| -------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------- |
| **[Hosted gateway](./auth#hosted-gateway-multi-tenant)** | Multiple sites sharing one Decap admin + Laika backend | A separate Worker / server you operate (the `laika-gateway` app moved to its own repo) | GitHub OAuth (or other provider) |
| **[Standalone Worker](./standalone-worker)**             | You want full control of storage, auth, and routing    | Your own Hono/Worker app                                                               | JWT (or your scheme)             |

The primary documented integration path is the **Standalone Worker (BYO storage)** wiring: you
construct a `StorageRepository`, wrap it in the ContentBase document/asset repos, and expose them
through `decapApi(...)`. Everything else (admin shell, OAuth2, framework bridges) builds on top of
that handler.

## In this section

- **[Self-Hosting Quickstart (FileSystem + Decap)](./quickstart-fs)** — the end-to-end starting
  point: a plain Node.js server with filesystem storage and the Decap admin, no cloud account.
- **[Standalone Worker (BYO storage)](./standalone-worker)** — wire `decapApi(...)` by hand over any
  storage repository; seeding the server-side config; WebDAV storage.
- **[Serving the Decap admin shell](./admin-shell)** — compile and serve the admin browser bundle.
- **[Authentication](./auth)** — machine-to-machine API keys, SSR guards, logging, the
  `decap-oauth2` server, and the multi-tenant hosted gateway.
- **[Widgets & Editor Components](./widgets-and-editors)** — icon widgets and the embedded-entry
  editor component.
- **[Framework setup notes](./frameworks)** — per-framework request bridges (Express, Next.js,
  SvelteKit, Astro, Nuxt, AdonisJS, FoalTS, and more).
