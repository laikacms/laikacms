# Roadmap

## Current Focus

- [ ] Stable v1.0 release
- [ ] Complete test coverage
- [ ] Documentation improvements

## Planned

- [ ] S3 storage implementation
- [ ] DynamoDB implementation
- [ ] More Decap CMS widgets
- [ ] Real-time collaboration
- [ ] GraphQL API option
- [ ] Capability sharing - bubble capabilities up through the chain of repositories; propagate capabilities via documents-api, storage-api, and assets-api to be read via proxy packages. *Note: Not currently necessary since Decap doesn't support paging, so everything is downloaded locally and capabilities like search can be done client-side. However, this is vital for supporting bigger datasets in the future.*

## Completed

- [x] Core architecture
- [x] Cloudflare R2 support
- [x] Decap CMS backend
- [x] OAuth2 with PKCE
- [x] File sanitization
- [x] Editorial workflow
