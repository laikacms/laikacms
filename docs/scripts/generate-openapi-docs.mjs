#!/usr/bin/env node
/**
 * Prebuild step: calls the four laikacms sub-API OpenAPI builders and writes their output
 * as static JSON files into `docs/public/openapi/` so the Scalar-rendered reference pages
 * can load them at runtime without bundling the schema builders into the site.
 *
 * Requires the laikacms workspace package to be built first (its dist/api/* files are
 * imported). When invoked via `pnpm build`/`pnpm dev`, Turbo's `^build` dependency chain
 * ensures that automatically. Running directly requires a prior
 * `pnpm --filter laikacms build`.
 *
 * Output (gitignored): docs/public/openapi/{assets,catalog,documents,storage}.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public', 'openapi');

mkdirSync(outDir, { recursive: true });

const { buildAssetsOpenApi } = await import('laikacms/assets-api');
const { buildCatalogOpenApi } = await import('laikacms/catalog-api');
const { buildDocumentsOpenApi } = await import('laikacms/documents-api');
const { buildStorageOpenApi } = await import('laikacms/storage-api');

const specs = [
  ['assets.json', buildAssetsOpenApi()],
  ['catalog.json', buildCatalogOpenApi()],
  ['documents.json', buildDocumentsOpenApi()],
  ['storage.json', buildStorageOpenApi()],
];

for (const [filename, spec] of specs) {
  writeFileSync(resolve(outDir, filename), JSON.stringify(spec, null, 2), 'utf8');
  console.log(`[generate-openapi-docs] wrote ${filename}`);
}
