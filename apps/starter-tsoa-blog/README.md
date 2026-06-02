# starter-tsoa-blog

A minimal blog using **tsoa** (TypeScript OpenAPI) + Express + **LaikaCMS**.

tsoa reads TypeScript controller decorators at build time and generates two things:

1. `src/generated/routes.ts` — an Express router wiring all `@Route` / `@Get` / `@Post` methods
2. `src/generated/swagger.json` — an OpenAPI 3 spec (optional; not used here)

## Quick start

```bash
pnpm dev    # runs `tsoa routes` then starts the server with tsx watch
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS.

## Key patterns

### Body-parser ordering

tsoa's generated `RegisterRoutes()` installs `express.json()` internally. Mount the Decap proxy
route **before** calling `RegisterRoutes(app)`:

```ts
// Register Decap proxy first
app.use('/api/decap', express.raw({ type: '*/*' }), decapHandler);
// Then wire tsoa routes (installs its own JSON parser for JSON routes)
RegisterRoutes(app);
```

### HTML responses from tsoa controllers

tsoa serialises return values to JSON by default. Use `@Produces('text/html')` to skip JSON
serialisation for routes that return raw HTML strings:

```ts
@Get('/')
@Produces('text/html')
async index(): Promise<string> {
  return '<!DOCTYPE html>…';
}
```

### Add `@tsoa/runtime` as a direct dependency

tsoa generates code that imports from `@tsoa/runtime`. That package is a transitive dependency of
`tsoa` itself, but pnpm's strict isolation means the generated file can't resolve it unless you add
`@tsoa/runtime` explicitly to your `package.json`.

## Structure

```
src/
  index.ts                 Express server + RegisterRoutes
  laika.ts                 createEmbeddedLaika setup
  controllers/
    blog.controller.ts     @Route / @Get / @Produces('text/html')
  generated/
    routes.ts              auto-generated (tsoa routes)
tsoa.json                  tsoa config (controllerPathGlobs, esm: true)
content/
  posts/                   markdown files managed by Decap
```

## Doc gaps surfaced

- tsoa's generated code imports `@tsoa/runtime` — add it as a direct dep
- `RegisterRoutes()` installs its own body parser; mount Decap proxy first
- `@Produces('text/html')` required for HTML string responses
