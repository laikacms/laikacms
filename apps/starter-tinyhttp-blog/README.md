# starter-tinyhttp-blog

A minimal blog starter using [tinyhttp](https://tinyhttp.v1rtl.site/) and
[LaikaCMS](https://laikacms.dev/).

## Stack

- **tinyhttp** — lightweight Express-compatible Node.js framework
- **sirv** — static file serving for the `public/` directory
- **LaikaCMS** — embedded Git-backed CMS with Decap CMS admin UI

## How it works

tinyhttp uses Node.js `IncomingMessage` / `ServerResponse` like Express, so the same bridge pattern
applies: `toLaikaRequest` converts the Node.js request into a WHATWG `Request` object that
`laika.fetch` expects.

The Decap CMS admin is served at `/admin/` via static files in `public/admin/`. The admin bundle
(`public/admin/bundle.js`) is built from `src/admin-client.ts` using esbuild.

## Getting started

```bash
pnpm install
pnpm dev
```

Then open:

- Blog: http://localhost:3000/
- Admin: http://localhost:3000/admin/

## Scripts

| Script           | Description                                             |
| ---------------- | ------------------------------------------------------- |
| `pnpm dev`       | Build admin bundle and start dev server with hot reload |
| `pnpm build`     | Build the admin bundle                                  |
| `pnpm start`     | Start the server (run `pnpm build` first)               |
| `pnpm typecheck` | Run TypeScript type checking                            |
