import { createCustomLaika } from '@laikacms/decap-integrations/custom';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';
import { WebDavStorageRepository } from 'laikacms/storage-webdav';

import { blogCollections } from './decap-config.js';

// Point at any RFC 4918 WebDAV server.
// In dev: the embedded server (startDevWebDav) runs at localhost:4918.
// In prod: set WEBDAV_URL to your Nextcloud, ownCloud, nginx-dav, etc.
const WEBDAV_URL = process.env['WEBDAV_URL'] ?? 'http://localhost:4918';

// Optional HTTP Basic auth for real WebDAV servers.
const auth = process.env['WEBDAV_USER']
  ? { username: process.env['WEBDAV_USER'], password: process.env['WEBDAV_PASS'] ?? '' }
  : undefined;

// Serializer registry: maps on-server file extensions to content serializers.
// WebDavStorageRepository uses this to read/write content in the right format.
const serializers = {
  md: markdownSerializer,
  yml: yamlSerializer,
  json: jsonSerializer,
  raw: rawSerializer,
};

const storage = new WebDavStorageRepository(
  { baseUrl: WEBDAV_URL, auth },
  serializers,
  'md',
);

export const laika = createCustomLaika({
  storage,
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
