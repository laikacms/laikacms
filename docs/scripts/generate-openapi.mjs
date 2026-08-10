#!/usr/bin/env node
/**
 * Prebuild step (LCMS-803): emits the OpenAPI 3.1 documents for the four
 * JSON:API surfaces as static artifacts the docs site can serve and any
 * consumer can point a client generator at.
 *
 * The specs are *generated*, never hand-authored. Each one comes from the
 * builder that the corresponding API server itself uses to answer
 * `GET /openapi.json`, so the published artifact cannot drift from the served
 * contract: both are the same function.
 *
 *   laikacms/storage/api    -> buildStorageOpenApi    -> storage.json
 *   laikacms/documents/api  -> buildDocumentsOpenApi  -> documents.json
 *   laikacms/assets/api     -> buildAssetsOpenApi     -> assets.json
 *   laikacms/catalog-api    -> buildCatalogOpenApi    -> catalog.json
 *
 * Output is fully generated: never hand-edit it.
 *   - docs/public/openapi/<surface>.json
 *   - docs/public/openapi/index.json  (manifest: surface -> title, path)
 *
 * Unlike the other generated docs output, these artifacts are *committed*
 * (LCMS-803). Idempotence makes that safe: keys are serialized in the
 * builders' own order and the directory is rebuilt from scratch, so
 * re-running against an unchanged schema produces byte-identical output. The
 * point of committing them is the diff, which is how a change to the wire
 * contract becomes visible in review instead of appearing silently at deploy.
 *
 * Invoked by the docs package's `dev`/`build` scripts, which always run this
 * first. Can also be run directly: `node scripts/generate-openapi.mjs`.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAssetsOpenApi } from 'laikacms/assets/api';
import { buildCatalogOpenApi } from 'laikacms/catalog-api';
import { buildDocumentsOpenApi } from 'laikacms/documents/api';
import { buildStorageOpenApi } from 'laikacms/storage/api';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'public', 'openapi');

/**
 * `basePath` only feeds the document's `servers` entry. These are the mount
 * points the docs describe; a server that mounts elsewhere rewrites `servers`
 * to its own origin when it serves the spec.
 */
const SURFACES = [
  { slug: 'documents', title: 'Documents API', basePath: '/documents', build: buildDocumentsOpenApi },
  { slug: 'assets', title: 'Assets API', basePath: '/assets', build: buildAssetsOpenApi },
  { slug: 'storage', title: 'Storage API', basePath: '/storage', build: buildStorageOpenApi },
  { slug: 'catalog', title: 'Catalog API', basePath: '/catalog', build: buildCatalogOpenApi },
];

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const manifest = [];

  for (const { slug, title, basePath, build } of SURFACES) {
    const doc = build({ basePath });

    const pathCount = Object.keys(doc.paths ?? {}).length;
    if (pathCount === 0) {
      throw new Error(
        `OpenAPI generator produced no paths for '${slug}'. The builder returned an empty document, `
          + 'which means the artifact would silently publish an empty API reference.',
      );
    }

    const file = `${slug}.json`;
    await writeFile(resolve(OUT_DIR, file), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    manifest.push({ slug, title, file, paths: pathCount });
    console.log(`  ${slug.padEnd(10)} ${String(pathCount).padStart(3)} paths -> public/openapi/${file}`);
  }

  await writeFile(resolve(OUT_DIR, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`generate-openapi: wrote ${manifest.length} specs to public/openapi/`);
}

await main();
