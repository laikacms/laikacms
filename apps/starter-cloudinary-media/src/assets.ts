import { CloudinaryAssetsRepository } from '@laikacms/cloudinary/assets-cloudinary';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * CLOUDINARY_CLOUD_NAME — Your Cloudinary cloud name (required).
 * CLOUDINARY_API_KEY    — API key (required).
 * CLOUDINARY_API_SECRET — API secret (required; never exposed to the browser).
 * GALLERY_FOLDER        — Cloudinary folder to use as the gallery (default: "laika-gallery").
 *
 * NOTE: CloudinaryAssetsRepository implements AssetsRepository, NOT StorageRepository.
 * It cannot be passed to createCustomLaika() — that preset only accepts a StorageRepository.
 * This is the first starter in the Laika suite that uses the assets contract directly,
 * without pairing with a content backend.
 *
 * Four distinctive Cloudinary traits this starter exercises:
 *
 *   1. Deterministic variation URLs — the default 6 transforms (thumbnail, small,
 *      medium, large, webp, avif) are computed locally as URL strings. No API call
 *      is made to Cloudinary; bandwidth and latency stay flat regardless of the
 *      number of variations.
 *
 *   2. Dual auth split — Upload API uses SHA-1 signed params (api_secret never
 *      crosses the wire); Admin API uses HTTP Basic (api_key:api_secret).
 *      signParams() is exported for reuse in custom upload code.
 *
 *   3. Path-shaped public_id — createAsset({ key: 'gallery/hero', … }) uploads
 *      with public_id=gallery/hero. Cloudinary auto-creates the folder.
 *
 *   4. Direct-children listing — Cloudinary's prefix match is recursive; the
 *      repository filters to direct children so nested assets don't leak in.
 *
 * Quick start:
 *   1. Create a free Cloudinary account at https://cloudinary.com
 *   2. Copy Cloud Name, API Key, and API Secret from the dashboard
 *   CLOUDINARY_CLOUD_NAME=my-cloud \
 *   CLOUDINARY_API_KEY=123456789012345 \
 *   CLOUDINARY_API_SECRET=<secret> \
 *   pnpm dev
 */
export const assets = new CloudinaryAssetsRepository({
  auth: {
    cloudName: requireEnv('CLOUDINARY_CLOUD_NAME'),
    apiKey: requireEnv('CLOUDINARY_API_KEY'),
    apiSecret: requireEnv('CLOUDINARY_API_SECRET'),
  },
});

export const GALLERY_FOLDER = process.env['GALLERY_FOLDER'] ?? 'laika-gallery';
