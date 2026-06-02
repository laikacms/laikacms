import { createCustomLaika, decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { DropboxStorageRepository } from '@laikacms/dropbox/storage-dropbox';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * DROPBOX_ACCESS_TOKEN — long-lived or short-lived OAuth2 access token.
 *   Get one from https://www.dropbox.com/developers/apps — create an app,
 *   add Files.content.read + Files.content.write scopes, generate a token.
 *
 * DROPBOX_ROOT_PATH — optional. Scopes all content under a subfolder in
 *   your Dropbox (e.g. /laika-blog). Lets one account host multiple sites.
 *   Defaults to the app's root folder.
 *
 * Each Laika storage object maps to one Dropbox file; each folder maps to
 * a Dropbox folder. The rootPath is prepended to every Dropbox API call.
 */
const accessToken = requireEnv('DROPBOX_ACCESS_TOKEN');
const rootPath = process.env.DROPBOX_ROOT_PATH ?? '';

const storage = new DropboxStorageRepository({
  auth: { accessToken },
  rootPath,
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    raw: rawSerializer,
  },
  defaultFileExtension: 'md',
});

export const laika = createCustomLaika({
  storage,
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export const adminHtml = decapAdminHtml();
