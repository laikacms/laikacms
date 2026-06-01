import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { PinataStorageRepository } from '@laikacms/pinata/storage-ipfs';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

/**
 * Pinata (IPFS) as the content store for LaikaCMS.
 *
 * Pinata is the first content-addressed backend in the LaikaCMS suite.
 * Every other backend is either path-addressed (S3, R2, Dropbox),
 * id-addressed (Firestore, Notion), or filter-indexed (Algolia, Meilisearch).
 * IPFS hashes content into a CID — same content always has the same address.
 *
 * Three traits distinct from every other backend in this repo:
 *
 *   1. Copy-on-write updates. IPFS can't mutate a CID in place — the CID IS
 *      the content hash. updateObject pins new content (→ new CID), then
 *      unpins the old CID. Between pin and unpin, pinList returns both CIDs;
 *      the repository always picks the newest by date_pinned.
 *
 *   2. Mutable name-index over immutable CIDs. The mutable mapping (storage
 *      key → CID) lives in each pin's metadata.name field and keyvalues.
 *      Reads query Pinata's pinList index — not the IPFS DAG directly.
 *
 *   3. Eventual consistency on reads. pinList updates within seconds but not
 *      synchronously with the pin call. Read-your-writes is not guaranteed;
 *      layer a client-side cache if needed.
 *
 * Required env vars:
 *   PINATA_JWT         — JWT from the Pinata dashboard (Keys → New Key → Admin)
 *
 * Optional:
 *   PINATA_GATEWAY_URL — dedicated gateway URL for downloads, e.g.
 *                        https://example.mypinata.cloud/ipfs
 *                        Falls back to the public Pinata gateway (rate-limited).
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const storage = new PinataStorageRepository({
  auth: { token: requireEnv('PINATA_JWT') },
  gatewayUrl: process.env['PINATA_GATEWAY_URL'],
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
