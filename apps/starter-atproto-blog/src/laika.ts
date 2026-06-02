import { AtprotoDataSource, AtprotoStorageRepository } from '@laikacms/atproto/storage-atproto';
import { createCustomLaika } from '@laikacms/decap-integrations/custom';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

import { blogCollections } from './decap-config.js';

// Required env vars:
//   ATP_PDS_URL  — Your PDS URL. Default: https://bsky.social
//   ATP_DID      — Your AT Protocol DID (e.g. did:plc:abc123...)
//   ATP_JWT      — Access JWT from POST /xrpc/com.atproto.server.createSession
//
// Posts are stored as `com.laikacms.file` records in your AT Protocol repo.
// Folders (e.g. the "posts" collection folder) become `com.laikacms.folder` records.
// Self-hosted PDS instances accept these lexicons freely; bsky.social warns about
// unknown lexicons but still persists the records.
//
// To get a JWT:
//   curl -X POST https://bsky.social/xrpc/com.atproto.server.createSession \
//     -H 'Content-Type: application/json' \
//     -d '{"identifier":"you.bsky.social","password":"app-password"}'
const pdsUrl = process.env['ATP_PDS_URL'] ?? 'https://bsky.social';
const did = process.env['ATP_DID'];
const accessJwt = process.env['ATP_JWT'];

if (!did || !accessJwt) {
  throw new Error(
    'Missing required env vars: ATP_DID and ATP_JWT must both be set.\n'
      + 'Use an app password (Settings → Privacy → App Passwords on bsky.social).',
  );
}

const dataSource = new AtprotoDataSource({
  auth: { accessJwt },
  repo: did,
  pdsUrl,
});

const storage = new AtprotoStorageRepository({
  dataSource,
  serializerRegistry: {
    md: markdownSerializer,
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
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
