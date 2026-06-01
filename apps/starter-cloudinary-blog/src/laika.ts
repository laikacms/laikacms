import { resolve } from 'node:path';

import { CloudinaryAssetsRepository } from '@laikacms/cloudinary/assets-cloudinary';
import { DEFAULT_DEV_TOKEN, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { decapApi } from '@laikacms/decap-integrations/decap-api';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { storageSerializerMarkdown } from 'laikacms/storage-serializers-markdown';

/**
 * Manual wiring — used when no preset fits.
 *
 * createCustomLaika always builds ContentBaseAssetsRepository (storage-backed).
 * If you need a different AssetsRepository (Cloudinary, S3 presigned, etc.)
 * call decapApi() directly:
 *
 *   1. Build a StorageRepository (content: markdown files on FS)
 *   2. Build DocumentsRepository (ContentBaseDocumentsRepository wraps storage)
 *   3. Build AssetsRepository (CloudinaryAssetsRepository for media)
 *   4. Call decapApi({ documents, storage, assets, basePath, authenticateAccessToken })
 *
 * Doc gap: createCustomLaika.assets is always ContentBaseAssetsRepository.
 * The only way to inject a different AssetsRepository today is via decapApi().
 */

const CONTENT_DIR = resolve(process.cwd(), 'content');

// 1. Storage (markdown content on local filesystem)
const storage = new FileSystemStorageRepository({
  basePath: CONTENT_DIR,
  serializerRegistry: { md: storageSerializerMarkdown },
  defaultFileExtension: 'md',
});

// 2. Settings + document repo (ContentBase layer on top of storage)
const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
const documents = new ContentBaseDocumentsRepository(storage, settings);

// 3. Assets repo — Cloudinary; images uploaded here instead of public/uploads
const assets = new CloudinaryAssetsRepository({
  auth: {
    cloudName: process.env['CLOUDINARY_CLOUD_NAME'] ?? '',
    apiKey: process.env['CLOUDINARY_API_KEY'] ?? '',
    apiSecret: process.env['CLOUDINARY_API_SECRET'] ?? '',
  },
  // Optional: override the default six transforms (thumbnail/small/medium/large/webp/avif)
  // variations: [{ name: 'og', transform: 'c_fill,w_1200,h_630', width: 1200, height: 630 }],
});

// 4. Wire the Decap JSON:API
export const laikaApi = decapApi({
  documents,
  storage,
  assets,
  basePath: '/api/decap',
  authenticateAccessToken: async token => {
    if (token === DEFAULT_DEV_TOKEN) {
      return { id: 'dev', email: 'dev@local.test', name: 'Dev Editor' };
    }
    const { AuthenticationError } = await import('laikacms/core');
    throw new AuthenticationError('invalid token');
  },
});

export const decapConfig = minimalBlogConfig();
export const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · Cloudinary Blog' });

// Also expose documents for direct server-side reads (bypass auth)
export { documents };
