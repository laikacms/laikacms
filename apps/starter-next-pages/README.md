# `@laikacms/starter-next-pages`

A **Next.js 15 with Pages Router** blog powered by **LaikaCMS** with the embedded **Decap CMS**
admin. Complement to `starter-next-blog` (App Router) for projects that haven't migrated yet.

## Stack

- Next.js 15 (Pages Router — `pages/` directory)
- `laikacms` + `@laikacms/decap-integrations/embedded`
- Decap CMS shell via `decapAdminHtml()` in an iframe

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-next-pages dev
```

Then:

- `http://localhost:3000` — public blog
- `http://localhost:3000/admin` — Decap CMS admin (iframed)

## Layout

```
apps/starter-next-pages/
├── content/posts/hello-world.md
├── next.config.mjs
├── src/
│   ├── lib/laika.ts                    # createEmbeddedLaika
│   └── pages/
│       ├── _app.tsx                    # layout chrome
│       ├── index.tsx                   # getServerSideProps → post list
│       ├── posts/[slug].tsx             # getServerSideProps → single post
│       ├── admin.tsx                   # decapAdminHtml in an iframe
│       └── api/decap/[...path].ts      # web-standard adapter → laika.fetch
└── tsconfig.json
```

## Why Pages Router?

The App Router (`app/` directory) is the new Next.js default, but **Pages Router is not deprecated**
— it ships in Next 15, gets new features, and a large slice of the Next.js ecosystem is still on it.
This starter exists so those projects can adopt LaikaCMS without first migrating to App Router.

## Key differences from the App Router variant

| Concern            | App Router (`starter-next-blog`)   | Pages Router (this starter)             |
| ------------------ | ---------------------------------- | --------------------------------------- |
| Data fetching      | `async function Page()`            | `getServerSideProps` / `getStaticProps` |
| API routes         | Web-standard `Request`/`Response`  | Node `req`/`res` — needs an adapter     |
| Decap admin        | Iframe with `srcDoc`               | Iframe with `URL.createObjectURL(html)` |
| Catch-all API path | `app/api/decap/[...path]/route.ts` | `pages/api/decap/[...path].ts`          |

The Pages Router API route needs the same web-standard adapter as the Express/Fastify starters
(`Readable.toWeb` / `Readable.fromWeb` + `config: { api: { bodyParser: false } }`). See
`pages/api/decap/[...path].ts` for the canonical shape — ~50 lines.

## Production hardening

Same checklist as the other starters. See [`docs/starters.md`](../../docs/starters.md).
