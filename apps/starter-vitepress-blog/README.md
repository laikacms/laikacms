# starter-vitepress-blog

A blog starter built with [VitePress](https://vitepress.dev) and
[LaikaCMS](https://github.com/laikacms/laikacms).

VitePress renders markdown files directly; LaikaCMS manages those same files via the Decap CMS. A
Vite plugin injects the Decap JSON:API handler into VitePress's dev server so a single `pnpm dev`
command starts everything — no separate backend process needed.

## Getting started

```sh
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) for the blog and
[http://localhost:5173/admin/](http://localhost:5173/admin/) for the CMS.

## How it works

| File                            | Role                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| `src/laika.ts`                  | `createEmbeddedLaika` — manages markdown in `docs/posts/`            |
| `.vitepress/config.mts`         | VitePress config + Vite plugin that injects the Decap API middleware |
| `docs/posts.data.ts`            | `createContentLoader` — feeds the blog home listing at build time    |
| `.vitepress/theme/BlogHome.vue` | Vue component rendered on the home page                              |
| `src/admin-client.ts`           | esbuild browser bundle: registers Laika backend + inits Decap CMS    |
| `docs/public/admin/index.html`  | Admin page that loads Decap CMS from CDN                             |

## Vite dev-server integration

Because VitePress's dev server runs on Node.js (Connect/http.IncomingMessage), `req` is not a Web
API `Request`. The Vite plugin in `config.mts` includes an `IncomingMessage →
Request` bridge so
`laika.fetch` can be called from inside `configureServer`.

## Building for production

```sh
pnpm build
pnpm preview
```

The build output in `.vitepress/dist` is a fully static site with no server dependency. The Decap
CMS admin is included as a static page and requires the LaikaCMS server to be running separately in
production (e.g. `pnpm dev` on the same machine, or a deployed API).
