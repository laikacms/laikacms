# starter-docusaurus-blog

A blog starter built with [Docusaurus v3](https://docusaurus.io) and
[LaikaCMS](https://github.com/laikacms/laikacms).

Docusaurus reads blog posts from the `blog/` directory as markdown files. LaikaCMS manages those
same files via the Decap CMS. A Docusaurus plugin uses `configureDevServer(app)` to inject the Decap
JSON:API handler into Docusaurus's Express-based dev server — no second process needed.

## Getting started

```sh
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) for the blog and
[http://localhost:3000/admin/](http://localhost:3000/admin/) for the CMS.

## How it works

| File                      | Role                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| `src/laika.ts`            | `createEmbeddedLaika` — manages markdown in `blog/`               |
| `src/laika-plugin.ts`     | Docusaurus plugin: `configureDevServer(app)` hooks into Express   |
| `docusaurus.config.ts`    | Docusaurus config that registers `laikaDecapPlugin`               |
| `src/admin-client.ts`     | esbuild browser bundle: registers Laika backend + inits Decap CMS |
| `static/admin/index.html` | Admin page that loads Decap CMS from CDN                          |

## Docusaurus dev-server integration

> **Doc gap / ergonomics note**: Docusaurus v3 does not expose a `configureDevServer(app)` lifecycle
> hook in its plugin API (unlike some older documentation suggests). The correct approach is
> `configureWebpack()` returning a partial webpack config with `devServer.setupMiddlewares`. Since
> `webpack-dev-server` types are transitive (not direct) deps of a Docusaurus project, the
> `devServer` parameter is typed as `any` here. This is a known rough edge when integrating Node.js
> middleware into Docusaurus.

Docusaurus's dev server is webpack-dev-server backed by Express (not Vite), so the integration uses
the Docusaurus plugin `configureDevServer(app: Application)` lifecycle hook. The Express `req` is a
Node.js `IncomingMessage`, requiring the same `IncomingMessage → Request` bridge used in
Express/Fastify/Koa starters.

```typescript
// src/laika-plugin.ts
export default function laikaDecapPlugin(): Plugin {
  return {
    name: 'laika-decap-api',
    configureDevServer(app: Application) {
      app.use('/api/decap', async (req, res) => {
        const webReq = await toWebRequest(req); // IncomingMessage → Request bridge
        const webRes = await laika.fetch(webReq);
        // forward response to res...
      });
    },
  };
}
```

## Building for production

```sh
pnpm build
pnpm preview
```

The build output in `build/` is a fully static site. The Decap CMS admin requires a running LaikaCMS
server in production (or the CMS can be used only during development).
