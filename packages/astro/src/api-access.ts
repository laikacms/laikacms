/**
 * What a served Laika API is allowed to do.
 *
 * Serving your content as a public read API from the same Astro site is a
 * legitimate thing to want — a static build already ships that content in its
 * HTML, so reading it back over JSON gives away nothing new.
 *
 * Two things do *not* follow from that, and this module is where they are held:
 *
 * 1. **Writes are not public.** The Laika JSON:API is full CRUD. "The content
 *    is public" is an argument about reads; it says nothing about letting
 *    anyone create, edit or delete it.
 * 2. **Drafts are not public.** Unpublished documents, revisions and locks are
 *    exactly the material a static build leaves out. A "public" API that served
 *    them would leak more than the site does.
 *
 * So the default is `'published'`: everything the built site already reveals,
 * and nothing else. `'read'` and `'all'` widen that deliberately, and are named
 * so a grep during an audit finds them.
 *
 * No authentication appears here. The sub-API builders take an `authorize`
 * callback and nothing else; identity is only needed once a policy wants to
 * distinguish callers, which none of these do.
 */

import type { AssetsAuthorizeInput } from 'laikacms/assets/api';
import type { DocumentsAuthorizeInput } from 'laikacms/documents/api';
import type { StorageAuthorizeInput } from 'laikacms/storage/api';

/**
 * How open a served API is.
 *
 * - `'published'` (default) — read published documents and their listings, plus
 *   capabilities and the OpenAPI description. No drafts, no revisions, no
 *   writes. This is the surface a static build already exposes.
 * - `'read'` — every read, including unpublished documents and revisions. Only
 *   appropriate behind your own authentication.
 * - `'all'` — everything, writes included. Never appropriate on a public route.
 */
export type ApiAccess = 'published' | 'read' | 'all';

/** Per-domain authorize callbacks, as the sub-API builders expect them. */
export interface ApiAuthorizers {
  documents: (input: DocumentsAuthorizeInput) => boolean;
  storage: (input: StorageAuthorizeInput) => boolean;
  assets: (input: AssetsAuthorizeInput) => boolean;
}

/** Documents actions that only ever read published material. */
const PUBLISHED_DOCUMENT_ACTIONS = new Set([
  'readOpenApi',
  'getCapabilities',
  'getSyncToken',
  'listChanges',
  'listRecordSummaries',
  'listRecords',
  'getDocument',
]);

/** Documents actions that read, but reach beyond what a built site publishes. */
const OTHER_DOCUMENT_READ_ACTIONS = new Set([
  'getUnpublished',
  'getRevision',
  'listRevisions',
  'getLock',
]);

const STORAGE_READ_ACTIONS = new Set([
  'readOpenApi',
  'getCapabilities',
  'listAtoms',
  'listAtomSummaries',
  'getObject',
  'getFolder',
  'getAtom',
]);

const ASSETS_READ_ACTIONS = new Set([
  'readOpenApi',
  'getCapabilities',
  'getSyncToken',
  'listChanges',
  'listResources',
  'getResource',
]);

/**
 * Build the authorize callbacks for an access level.
 *
 * Allowlists, not denylists: an action added to `laikacms` in a later version is
 * denied here until someone decides it belongs, rather than silently becoming
 * public the moment a dependency updates.
 */
export function authorizersFor(access: ApiAccess): ApiAuthorizers {
  if (access === 'all') {
    return { documents: () => true, storage: () => true, assets: () => true };
  }

  const documentActions = access === 'read'
    ? new Set([...PUBLISHED_DOCUMENT_ACTIONS, ...OTHER_DOCUMENT_READ_ACTIONS])
    : PUBLISHED_DOCUMENT_ACTIONS;

  return {
    documents: input => {
      if (!documentActions.has(input.action)) return false;
      // `listRecords` and `listRecordSummaries` take a `type` filter. Under
      // 'published' the caller must not be able to ask for drafts by passing
      // `filter[type]=unpublished` — the action name alone does not settle it.
      if (access === 'published' && isRecordListing(input)) {
        return input.options.type === 'published';
      }
      return true;
    },
    storage: input => STORAGE_READ_ACTIONS.has(input.action),
    assets: input => ASSETS_READ_ACTIONS.has(input.action),
  };
}

function isRecordListing(
  input: DocumentsAuthorizeInput,
): input is Extract<DocumentsAuthorizeInput, { action: 'listRecords' | 'listRecordSummaries' }> {
  return input.action === 'listRecords' || input.action === 'listRecordSummaries';
}
