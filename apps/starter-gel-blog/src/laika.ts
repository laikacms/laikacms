import { GelDataSource, GelStorageRepository } from '@laikacms/gel/storage-gel';
import { createCustomLaika, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

/**
 * Gel (formerly EdgeDB) storage for LaikaCMS.
 *
 * GelDataSource connects to the Gel HTTP EdgeQL endpoint.
 * GelStorageRepository maps LaikaCMS storage operations to EdgeQL:
 *
 *   getObject    → SELECT LaikaFile … FILTER .parent = <str>$parent AND .name = <str>$name
 *   createObject → INSERT LaikaFile { path := <str>$path, content := <str>$content, … }
 *   removeAtoms  → FOR p IN array_unpack(<array<str>>$paths) UNION ( DELETE LaikaFile … )
 *
 * Notable EdgeQL traits vs. every prior backend in the LaikaCMS suite:
 *   1. `:=` is assignment, `=` is equality (other backends use only `=`)
 *   2. `<type>$param` casts (e.g. `<str>$path`) — typed at the query level
 *   3. `FOR x IN array_unpack(…) UNION (…)` — atomic set comprehension for batch deletes
 *
 * Required env vars:
 *   GEL_URL    — Gel HTTP endpoint, e.g. http://localhost:5656
 *   GEL_BRANCH — branch name (default: "main")
 *   GEL_USER   — username (default: "gel" or "edgedb")
 *   GEL_PASSWORD — password
 */
const dataSource = new GelDataSource({
  url: process.env['GEL_URL'] ?? 'http://localhost:5656',
  branch: process.env['GEL_BRANCH'] ?? 'main',
  auth: {
    basic: {
      username: process.env['GEL_USER'] ?? 'gel',
      password: process.env['GEL_PASSWORD'] ?? '',
    },
  },
});

const storage = new GelStorageRepository({
  dataSource,
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});

export const decapConfig = minimalBlogConfig();

export const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
