import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { SolidDataSource, SolidStorageRepository } from '@laikacms/solid/storage-solid';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * SOLID_POD_ROOT     — Root URL of your Solid Pod container (required).
 *                      MUST end with a trailing slash.
 *                      Examples:
 *                        https://alice.solidcommunity.net/laika/
 *                        https://storage.inrupt.com/<uuid>/laika/
 *                        http://localhost:3001/alice/laika/   (CommunitySolidServer)
 *
 * SOLID_ACCESS_TOKEN — Pre-acquired Solid-OIDC access token (optional for
 *                      public pods with anonymous write access to /public/).
 *                      Use @inrupt/solid-client-authn-* to acquire DPoP-bound
 *                      tokens for private pods.
 *
 * Five distinctive Solid Pod / LDP traits this starter exercises:
 *
 *   1. URI-as-identity — every resource IS its HTTPS URL. No opaque IDs.
 *      The URL surfaces in metadata.revisionId.
 *
 *   2. Trailing-slash addressing — <pod>/posts/ (with /) is an LDP
 *      container (folder); <pod>/posts/hello.md (without /) is a resource.
 *      The URL itself disambiguates type — first backend where this is true.
 *
 *   3. RDF/Turtle container listings — GET <container/> with
 *      Accept: text/turtle returns ldp:contains triples. The package ships
 *      its own focused Turtle parser; no external RDF library needed.
 *      First triple-store / RDF backend in the Laika suite.
 *
 *   4. Content negotiation — file content uses text/markdown or
 *      application/json; container metadata uses text/turtle.
 *
 *   5. If-None-Match: * for create-only PUTs — createObject sends this
 *      precondition header; 412 Precondition Failed → EntryAlreadyExistsError.
 *      First backend using HTTP precondition semantics as the OCC primitive.
 *
 * Quick start with CommunitySolidServer (local dev, no auth needed):
 *   npx @solid/community-server -p 3001 -c @css:config/file.json
 *   SOLID_POD_ROOT=http://localhost:3001/alice/laika/ pnpm dev
 *
 * Quick start with solidcommunity.net (public Solid provider):
 *   1. Register at https://solidcommunity.net
 *   2. Use @inrupt/solid-client-authn-browser or solid-node-client to obtain
 *      a DPoP-bound access token for your pod
 *   SOLID_POD_ROOT=https://alice.solidcommunity.net/laika/ \
 *   SOLID_ACCESS_TOKEN=<dpop-bound-token> pnpm dev
 */
const dataSource = new SolidDataSource({
  podRoot: requireEnv('SOLID_POD_ROOT'),
  auth: process.env['SOLID_ACCESS_TOKEN']
    ? { accessToken: process.env['SOLID_ACCESS_TOKEN'] }
    : undefined,
});

const storage = new SolidStorageRepository({
  dataSource,
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

export const decapConfig = minimalBlogConfig();

export const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export { decapAdminHtml };
