import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { HygraphStorageRepository } from '@laikacms/hygraph/storage-hygraph';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * HYGRAPH_ENDPOINT — GraphQL Content API endpoint (required).
 *   Found in Project Settings → API Access → Content API.
 *   Example: https://api-eu-west-2.hygraph.com/v2/<project-id>/master
 *
 * HYGRAPH_PAT — Permanent Auth Token (required).
 *   Generated in Project Settings → API Access → Permanent Auth Tokens.
 *   Needs content read + write permissions.
 *
 * HYGRAPH_STAGE — Hygraph stage to read/write (default: DRAFT).
 *   Set to PUBLISHED to read published content only.
 *
 * IMPORTANT — pre-provision two content models in Hygraph Studio before
 * starting this server:
 *
 *   model LaikaObject {
 *     parent     String
 *     name       String
 *     path       String
 *     extension  String
 *     content    String    (long-text / multi-line)
 *   }
 *
 *   model LaikaFolder {
 *     parent  String
 *     name    String
 *     path    String
 *   }
 *
 * The repository never creates or modifies the schema. Without these models,
 * all queries fail with 'Cannot query field' GraphQL errors → InternalError.
 *
 * Three distinctive Hygraph traits this starter exercises:
 *   1. First true-GraphQL transport — standard GraphQL mutations and queries,
 *      not REST or GROQ.
 *   2. One query, files + folders — listAtomSummaries fires a single
 *      ListLaikaChildren query that returns laikaObjects and laikaFolders
 *      in parallel (one HTTP round-trip instead of two).
 *   3. Stage-aware — reads and writes respect the configured stage;
 *      set HYGRAPH_STAGE=PUBLISHED to read only published content.
 *
 * Quick start:
 *   1. Create a Hygraph project at https://app.hygraph.com
 *   2. Add LaikaObject and LaikaFolder models per the schema above
 *   3. Generate a Permanent Auth Token with read + write access
 *   HYGRAPH_ENDPOINT=https://... HYGRAPH_PAT=<token> pnpm dev
 */
const storage = new HygraphStorageRepository({
  endpoint: requireEnv('HYGRAPH_ENDPOINT'),
  auth: {
    token: requireEnv('HYGRAPH_PAT'),
  },
  stage: (process.env['HYGRAPH_STAGE'] ?? 'DRAFT') as 'DRAFT' | 'PUBLISHED',
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
