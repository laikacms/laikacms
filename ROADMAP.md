# Roadmap

## Current Focus

- [ ] Stable v1.0 release
- [ ] Complete test coverage
- [ ] Documentation improvements
- [ ] Convert to Effect (add helper functions to return types for non-effect consumers)
- [ ] Use effect to convert repositories so they are able to: - yield progress - yield errors
      (warnings) - yield 0, 1 or n results of a specific type - end with fatal errors - succeed with
      metadata (like pagination information)

## Planned

- [ ] S3 storage implementation
- [ ] DynamoDB implementation
- [ ] More Decap CMS widgets
- [ ] Real-time collaboration
- [ ] GraphQL API option
- [ ] Capability sharing - bubble capabilities up through the chain of repositories; propagate
      capabilities via documents-api, storage-api, and assets-api to be read via proxy packages.
      _Note: Not currently necessary since Decap doesn't support paging, so everything is downloaded
      locally and capabilities like search can be done client-side. However, this is vital for
      supporting bigger datasets in the future._

## Completed

- [x] Core architecture
- [x] Cloudflare R2 support
- [x] Decap CMS backend
- [x] OAuth2 with PKCE
- [x] File sanitization
- [x] Editorial workflow
- [x] Netlify git-gateway compatible HTTP handler (`@laikacms/git-gateway`) —
      lets Decap CMS configured with `backend: git-gateway` point at a Laika
      worker without changing client config
- [x] Hosted multi-tenant gateway app (`apps/laika-gateway`) — one GitHub App
      that anyone can install on their repo; tenants point Decap at the
      gateway URL (`/github/{owner}/{repo}/api/decap`) instead of standing up
      their own Worker. Namespaced URL scheme leaves room for `/gitlab/...`
      etc. later.
